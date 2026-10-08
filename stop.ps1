<#
.SYNOPSIS
  Stops AI Office: the frontend, the backend and the project's containers, and unloads the model from GPU memory.

.DESCRIPTION
  Containers are stopped, not removed: the database keeps its data. Ollama and Docker Desktop are shared with other
  programs, so they keep running unless -All is given.

.PARAMETER All
  Also quit Ollama and Docker Desktop.
#>
param([switch]$All)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$RunDir = Join-Path $Root '.run'
$Problems = @()

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   OK  $text" -ForegroundColor Green }
function Problem($text) { Write-Host "   FAILED  $text" -ForegroundColor Red; $script:Problems += $text }

function Read-DotEnv($path) {
    $values = @{}
    if (Test-Path $path) {
        foreach ($line in Get-Content $path) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $values[$Matches[1]] = $Matches[2].Trim().Trim('"') }
        }
    }
    return $values
}

# Native commands run with errors not fatal: Windows PowerShell turns their stderr output (progress too) into errors.
function Invoke-Native([scriptblock]$Command) {
    $ErrorActionPreference = 'Continue'
    $output = & $Command 2>&1 | ForEach-Object { "$_" }
    return [pscustomobject]@{ Ok = ($LASTEXITCODE -eq 0); Output = ($output -join "`n") }
}

function Wait-Until([scriptblock]$Check, [int]$Seconds, [int]$Every = 1) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try { if (& $Check) { return $true } } catch { }
        Start-Sleep -Seconds $Every
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Get-Listener($port) { Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1 }

# A process belongs to this project when it or one of its parents runs from the project folder
# (the venv python.exe hands over to the base Python, whose child is the one listening).
function Test-Ours($id) {
    for ($i = 0; $i -lt 4 -and $id; $i++) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
        if (-not $proc) { return $false }
        foreach ($text in @($proc.CommandLine, $proc.ExecutablePath)) {
            if ($text -and $text.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
        }
        $id = $proc.ParentProcessId
    }
    return $false
}

# Stops the process started by start.ps1 (whole tree), then anything of this project still listening on the port.
# A process on the port that does not belong to this project is left alone and reported.
function Stop-OfficeProcess($name, $port) {
    Step "$name (port $port)"
    $pidFile = Join-Path $RunDir "$($name.ToLower()).pid"
    if (Test-Path $pidFile) {
        $id = (Get-Content $pidFile -Raw).Trim()
        if (Get-Process -Id $id -ErrorAction SilentlyContinue) { Invoke-Native { taskkill /PID $id /T /F } | Out-Null }
        Remove-Item $pidFile -Force
    }
    $listener = Get-Listener $port
    if ($listener) {
        if (Test-Ours $listener.OwningProcess) {
            Invoke-Native { taskkill /PID $listener.OwningProcess /T /F } | Out-Null
        } else {
            $other = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            Problem "port $port is used by another program ($other, pid $($listener.OwningProcess)); not touched"
            return
        }
    }
    if (Wait-Until { -not (Get-Listener $port) } 15) { Ok 'stopped' } else { Problem "$name still listens on port $port" }
}

Stop-OfficeProcess 'Frontend' 3000
Stop-OfficeProcess 'Backend' 8000

# ---------- model ----------
$backendEnv = Read-DotEnv (Join-Path $Root 'backend\.env')
$ollamaUrl = if ($backendEnv['OLLAMA_URL']) { $backendEnv['OLLAMA_URL'].TrimEnd('/') } else { 'http://localhost:11434' }
$model = if ($backendEnv['OLLAMA_MODEL']) { $backendEnv['OLLAMA_MODEL'] } else { 'qwen3.8:27b' }
Step "Ollama model $model"
function Test-Loaded { @((Invoke-RestMethod -Uri "$ollamaUrl/api/ps" -TimeoutSec 3 -UseBasicParsing).models | Where-Object { $_.name -eq $model }).Count -gt 0 }
try {
    if (Test-Loaded) {
        $body = @{ model = $model; keep_alive = 0 } | ConvertTo-Json
        Invoke-RestMethod -Uri "$ollamaUrl/api/generate" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 30 | Out-Null
        if (Wait-Until { -not (Test-Loaded) } 20) { Ok 'unloaded from GPU memory' } else { Problem "$model is still loaded in GPU memory" }
    } else { Ok 'not loaded' }
} catch {
    Ok "Ollama is not running ($ollamaUrl)"
}

# ---------- containers ----------
Step 'Database and SearXNG containers'
if ((Invoke-Native { docker info --format '{{.ServerVersion}}' }).Ok) {
    Push-Location $Root
    try { $compose = Invoke-Native { docker compose stop } } finally { Pop-Location }
    $running = (Invoke-Native { docker ps --filter name=ai-office- --format '{{.Names}}' }).Output.Trim()
    if ($compose.Ok -and -not $running) { Ok 'stopped (data kept)' } else { Problem "containers still running: $running $($compose.Output)" }
} else {
    Ok 'Docker is not running'
}

# ---------- -All: Ollama and Docker Desktop ----------
if ($All) {
    Step 'Ollama'
    Get-Process -Name 'ollama app', 'ollama', 'llama-server' -ErrorAction SilentlyContinue | Stop-Process -Force
    if (Wait-Until { -not (Get-Process -Name 'ollama', 'llama-server' -ErrorAction SilentlyContinue) } 15) { Ok 'quit' } else { Problem 'Ollama is still running' }

    Step 'Docker Desktop'
    if ((Invoke-Native { docker info --format '{{.ServerVersion}}' }).Ok) {
        $quit = Invoke-Native { docker desktop stop }
        if (-not $quit.Ok) { Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue | Stop-Process -Force }
        if (Wait-Until { -not (Invoke-Native { docker info --format '{{.ServerVersion}}' }).Ok } 90 3) { Ok 'quit' } else { Problem 'Docker Desktop is still running' }
    } else { Ok 'not running' }
}

if ($Problems.Count) {
    Write-Host "`nNot everything stopped:" -ForegroundColor Red
    $Problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
Write-Host "`nAI Office is stopped.$(if (-not $All) { ' Ollama and Docker Desktop keep running (.\stop.ps1 -All quits them too).' })" -ForegroundColor Green
exit 0
