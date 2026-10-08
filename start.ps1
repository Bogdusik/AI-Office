<#
.SYNOPSIS
  Starts AI Office: Docker Desktop, the database and SearXNG containers, Ollama with the model, the backend and the frontend.

.DESCRIPTION
  Every service is checked before the next one starts; the script stops with a clear message when something does not
  come up. Services that are already running are left as they are. The backend and the frontend run hidden in the
  background; their output goes to logs/. Stop everything with .\stop.ps1.

.PARAMETER Open
  Open the office in the default browser at the end.
#>
param([switch]$Open)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Logs = Join-Path $Root 'logs'
$RunDir = Join-Path $Root '.run'
$BackendPort = 8000
$FrontendPort = 3000
$Status = [ordered]@{}

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   !!  $text" -ForegroundColor Yellow }
function Fail($text, $hint) {
    Write-Host "   FAILED  $text" -ForegroundColor Red
    if ($hint) { Write-Host "   $hint" -ForegroundColor Red }
    Write-Host "`nAI Office did not start. Fix the problem above and run .\start.ps1 again (.\stop.ps1 stops what is already running)." -ForegroundColor Red
    exit 1
}

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

function Wait-Until([scriptblock]$Check, [int]$Seconds, [int]$Every = 2, [scriptblock]$Abort = { $false }) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if (& $Abort) { return $false }
        try { if (& $Check) { return $true } } catch { }
        Start-Sleep -Seconds $Every
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Get-Json($url, [int]$Timeout = 5) { Invoke-RestMethod -Uri $url -TimeoutSec $Timeout -UseBasicParsing }

function Test-Http($url) {
    try { return (Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing).StatusCode -eq 200 } catch { return $false }
}

function Test-Port($port) { [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) }

function Get-PortOwner($port) {
    $id = (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    $name = (Get-Process -Id $id -ErrorAction SilentlyContinue).ProcessName
    return "$name, pid $id"
}

function Show-LogTail($file) {
    if (Test-Path $file) {
        Write-Host "   Last lines of $file :" -ForegroundColor DarkGray
        Get-Content $file -Tail 15 | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
    }
}

function Start-Hidden($name, $file, $arguments, $workdir) {
    New-Item -ItemType Directory -Force $Logs, $RunDir | Out-Null
    $out = Join-Path $Logs "$name.log"
    $err = Join-Path $Logs "$name.err.log"
    $proc = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $workdir -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    Set-Content -Path (Join-Path $RunDir "$name.pid") -Value $proc.Id -Encoding ascii
    return $proc
}

# ---------- settings ----------
$rootEnv = Read-DotEnv (Join-Path $Root '.env')
$backendEnv = Read-DotEnv (Join-Path $Root 'backend\.env')
if (-not (Test-Path (Join-Path $Root '.env'))) { Fail 'No .env in the project root.' 'Copy .env.example to .env and set POSTGRES_PASSWORD (see README).' }
if (-not (Test-Path (Join-Path $Root 'backend\.env'))) { Fail 'No backend\.env.' 'Copy backend\.env.example to backend\.env and set the database password (see README).' }
$worker = if ($backendEnv['EXECUTOR_WORKER']) { $backendEnv['EXECUTOR_WORKER'] } else { 'fake' }
$ollamaUrl = if ($backendEnv['OLLAMA_URL']) { $backendEnv['OLLAMA_URL'].TrimEnd('/') } else { 'http://localhost:11434' }
$model = if ($backendEnv['OLLAMA_MODEL']) { $backendEnv['OLLAMA_MODEL'] } else { 'qwen3.8:27b' }
$numCtx = if ($backendEnv['OLLAMA_NUM_CTX']) { [int]$backendEnv['OLLAMA_NUM_CTX'] } else { 16384 }
$searxPort = if ($rootEnv['SEARXNG_PORT']) { $rootEnv['SEARXNG_PORT'] } else { '8888' }
$searxUrl = "http://127.0.0.1:$searxPort"

# ---------- Docker Desktop ----------
Step 'Docker Desktop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'The docker command is not available.' 'Install Docker Desktop: https://www.docker.com/products/docker-desktop/' }
function Test-Docker { (Invoke-Native { docker info --format '{{.ServerVersion}}' }).Ok }
if (Test-Docker) {
    Ok 'already running'
} else {
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path $desktop)) { Fail 'Docker is not running and Docker Desktop was not found.' "Expected at $desktop; start Docker by hand." }
    Write-Host '   starting Docker Desktop (up to 3 minutes)...'
    Start-Process -FilePath $desktop | Out-Null
    if (-not (Wait-Until { Test-Docker } 180 3)) { Fail 'Docker Desktop did not start within 3 minutes.' 'Open Docker Desktop and look at its status, then run the script again.' }
    Ok 'started'
}
$Status['Docker Desktop'] = 'running'

# ---------- containers ----------
Step 'Database and SearXNG containers'
Push-Location $Root
try {
    $compose = Invoke-Native { docker compose up -d }
    if (-not $compose.Ok) { Fail 'docker compose up failed:' $compose.Output }
} finally { Pop-Location }
function Get-DbHealth { (Invoke-Native { docker inspect -f '{{.State.Health.Status}}' ai-office-db }).Output.Trim() }
if (-not (Wait-Until { (Get-DbHealth) -eq 'healthy' } 90)) {
    Fail "PostgreSQL (ai-office-db) is not healthy: $(Get-DbHealth)." 'See: docker logs ai-office-db'
}
$dbPort = if ($rootEnv['POSTGRES_PORT']) { $rootEnv['POSTGRES_PORT'] } else { '5433' }
Ok "PostgreSQL healthy on localhost:$dbPort"
$Status['PostgreSQL'] = "localhost:$dbPort - healthy"

if (Wait-Until { (Get-Json "$searxUrl/search?q=ai+office&format=json" 10) -ne $null } 60 3) {
    Ok "SearXNG answers on $searxUrl"
    $Status['SearXNG'] = "$searxUrl - search ok"
} else {
    Warn "SearXNG does not answer on $searxUrl. Agents will work without web search."
    Warn 'Check SEARXNG_SECRET in .env and: docker logs ai-office-searxng'
    $Status['SearXNG'] = "$searxUrl - NOT answering (no web search)"
}

# ---------- Ollama ----------
if ($worker -eq 'llm') {
    Step "Ollama and the model $model"
    function Test-Ollama { try { (Get-Json "$ollamaUrl/api/version" 3).version } catch { $null } }
    if (Test-Ollama) {
        Ok "already running ($ollamaUrl)"
    } else {
        $app = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
        if (Test-Path $app) { Start-Process -FilePath $app | Out-Null }
        elseif (Get-Command ollama -ErrorAction SilentlyContinue) { Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden | Out-Null }
        else { Fail 'Ollama is not installed.' 'Install it from https://ollama.com, or set EXECUTOR_WORKER=fake in backend\.env to run without a model.' }
        if (-not (Wait-Until { Test-Ollama } 60)) { Fail "Ollama did not answer on $ollamaUrl within 60 s." 'Start Ollama by hand and run the script again.' }
        Ok "started ($ollamaUrl)"
    }
    $version = Test-Ollama
    $names = @((Get-Json "$ollamaUrl/api/tags").models | ForEach-Object { $_.name })
    if (-not ($names -contains $model -or $names -contains "${model}:latest")) {
        Fail "The model $model is not downloaded." "Run: ollama pull $model   (or set OLLAMA_MODEL in backend\.env to a model you have)"
    }
    $loaded = @((Get-Json "$ollamaUrl/api/ps").models | ForEach-Object { $_.name })
    if (-not ($loaded -contains $model)) {
        Write-Host '   loading the model into GPU memory (up to 3 minutes)...'
        $body = @{ model = $model; prompt = ''; keep_alive = '30m'; options = @{ num_ctx = $numCtx } } | ConvertTo-Json
        try {
            Invoke-RestMethod -Uri "$ollamaUrl/api/generate" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 180 | Out-Null
        } catch { Fail "Ollama could not load $model : $($_.Exception.Message)" 'Check free GPU memory (nvidia-smi) and the Ollama logs.' }
    }
    $info = (Get-Json "$ollamaUrl/api/ps").models | Where-Object { $_.name -eq $model } | Select-Object -First 1
    if (-not $info) { Fail "$model is not loaded after the request." 'Check the Ollama logs.' }
    $vram = [math]::Round($info.size_vram / 1e9, 1)
    Ok "Ollama $version, $model loaded ($vram GB in VRAM)"
    $Status['Ollama'] = "$ollamaUrl - v$version, $model loaded ($vram GB VRAM)"
} else {
    Step 'Ollama'
    Warn "EXECUTOR_WORKER=$worker in backend\.env: the fake executor, no model needed. Set EXECUTOR_WORKER=llm for real work."
    $Status['Ollama'] = 'not used (fake executor)'
}

# ---------- backend ----------
Step "Backend (port $BackendPort)"
$python = Join-Path $Root 'backend\.venv\Scripts\python.exe'
function Test-Health {
    try { $h = Get-Json "http://localhost:$BackendPort/health" 3; return ($h.status -eq 'ok' -and $h.db) } catch { return $false }
}
if (Test-Port $BackendPort) {
    if (Test-Health) { Ok 'already running' }
    else { Fail "Port $BackendPort is taken by $(Get-PortOwner $BackendPort), but /health does not answer." "If it is an old backend, run .\stop.ps1; otherwise close that program, then run .\start.ps1 again." }
} else {
    if (-not (Test-Path $python)) { Fail 'No backend virtual environment.' 'cd backend; python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements-dev.txt' }
    Push-Location (Join-Path $Root 'backend')
    try {
        $migrate = Invoke-Native { & $python -m alembic upgrade head }
        if (-not $migrate.Ok) { Fail 'Database migrations failed:' $migrate.Output }
    } finally { Pop-Location }
    Ok 'migrations up to date'
    $proc = Start-Hidden 'backend' $python @('-m', 'uvicorn', 'app.main:app', '--port', $BackendPort, '--timeout-graceful-shutdown', '2') (Join-Path $Root 'backend')
    if (-not (Wait-Until { Test-Health } 60 2 { $proc.HasExited })) {
        Show-LogTail (Join-Path $Logs 'backend.err.log')
        Fail "The backend did not answer on http://localhost:$BackendPort/health within 60 s." 'See logs\backend.err.log.'
    }
    Ok "started (pid $($proc.Id))"
}
$llm = try { Get-Json "http://localhost:$BackendPort/api/v1/llm/status" 10 } catch { [pscustomobject]@{ ok = $false; worker = $worker; message = $_.Exception.Message } }
if ($worker -eq 'llm' -and -not $llm.ok) { Warn "The backend reports a model problem: $($llm.message)" }
$Status['Backend'] = "http://localhost:$BackendPort - health ok, executor $($llm.worker), API docs /docs"

# ---------- frontend ----------
Step "Frontend (port $FrontendPort)"
$frontendUrl = "http://localhost:$FrontendPort"
if (Test-Port $FrontendPort) {
    if (Test-Http $frontendUrl) { Ok 'already running' }
    else { Fail "Port $FrontendPort is taken by $(Get-PortOwner $FrontendPort), but the page does not open." "If it is an old frontend, run .\stop.ps1; otherwise close that program, then run .\start.ps1 again." }
} else {
    if (-not (Test-Path (Join-Path $Root 'frontend\node_modules'))) { Fail 'Frontend dependencies are not installed.' 'cd frontend; npm ci' }
    $proc = Start-Hidden 'frontend' 'npm.cmd' @('run', 'dev', '--', '-p', $FrontendPort) (Join-Path $Root 'frontend')
    Write-Host '   compiling the page (the first start takes up to 2 minutes)...'
    if (-not (Wait-Until { Test-Http $frontendUrl } 150 3 { $proc.HasExited })) {
        Show-LogTail (Join-Path $Logs 'frontend.err.log')
        Fail "The page did not open on $frontendUrl within 150 s." 'See logs\frontend.log and logs\frontend.err.log.'
    }
    Ok "started (pid $($proc.Id))"
}
$Status['Frontend'] = "$frontendUrl - page opens"

# ---------- summary ----------
Write-Host "`nAI Office is running:" -ForegroundColor Green
foreach ($k in $Status.Keys) { Write-Host ('  {0,-15} {1}' -f $k, $Status[$k]) }
Write-Host "`nOpen $frontendUrl. Logs: logs\. Stop: .\stop.ps1"
if ($Open) { Start-Process $frontendUrl }
exit 0
