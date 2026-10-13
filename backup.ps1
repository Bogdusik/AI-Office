<#
.SYNOPSIS
  Backs up the AI Office database to a folder outside the project and keeps the latest copies.

.DESCRIPTION
  Runs pg_dump (custom format) inside the database container, checks that pg_restore can read the file, and saves it
  as <database>-<yyyyMMdd-HHmmss>.dump in the backup folder. Only the newest copies are kept (14 by default). When a
  mirror folder is set (for example a OneDrive folder), the fresh copy is also copied there and the same number is kept.
  The database must be running (.\start.ps1, or docker compose up -d db). No password is needed or printed.

  Folders come from the parameters, else from BACKUP_DIR / BACKUP_MIRROR_DIR in the root .env, else
  %USERPROFILE%\Backups\AI-Office and no mirror.

.PARAMETER Dir
  Backup folder (outside the project).

.PARAMETER MirrorDir
  Optional second folder that also gets the fresh copy.

.PARAMETER Keep
  How many copies to keep in each folder.

.PARAMETER Database
  Database to back up (POSTGRES_DB from the root .env by default).

.EXAMPLE
  .\backup.ps1
.EXAMPLE
  .\backup.ps1 -MirrorDir "$env:OneDrive\Backups\AI-Office"
#>
param([string]$Dir, [string]$MirrorDir, [int]$Keep = 14, [string]$Database)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Container = 'ai-office-db'

function Read-DotEnv($path) {
    $values = @{}
    if (Test-Path $path) {
        foreach ($line in Get-Content $path) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $values[$Matches[1]] = $Matches[2].Trim().Trim('"') }
        }
    }
    return $values
}

function Fail($text) {
    Write-Host "   FAILED  $text" -ForegroundColor Red
    exit 1
}

function Invoke-Native([scriptblock]$Command) {
    $ErrorActionPreference = 'Continue'
    $output = & $Command 2>&1 | ForEach-Object { "$_" }
    return [pscustomobject]@{ Ok = ($LASTEXITCODE -eq 0); Output = ($output -join "`n") }
}

function Keep-Latest($folder, $prefix, [int]$count) {
    Get-ChildItem -Path $folder -Filter "$prefix-*.dump" -File | Sort-Object Name -Descending | Select-Object -Skip $count |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

$envFile = Read-DotEnv (Join-Path $Root '.env')
if (-not $Dir) { $Dir = if ($envFile['BACKUP_DIR']) { $envFile['BACKUP_DIR'] } else { Join-Path $env:USERPROFILE 'Backups\AI-Office' } }
if (-not $MirrorDir -and $envFile['BACKUP_MIRROR_DIR']) { $MirrorDir = $envFile['BACKUP_MIRROR_DIR'] }
if (-not $Database) { $Database = if ($envFile['POSTGRES_DB']) { $envFile['POSTGRES_DB'] } else { 'ai_office' } }
$user = if ($envFile['POSTGRES_USER']) { $envFile['POSTGRES_USER'] } else { 'ai_office' }
if ($Keep -lt 1) { Fail 'Keep must be at least 1.' }

$rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
foreach ($folder in @($Dir, $MirrorDir) | Where-Object { $_ }) {
    if (([IO.Path]::GetFullPath($folder).TrimEnd('\') + '\').StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        Fail "The backup folder $folder is inside the project; choose a folder outside it."
    }
}

$running = Invoke-Native { docker inspect -f '{{.State.Running}}' $Container }
if (-not $running.Ok -or $running.Output.Trim() -ne 'true') { Fail "The database container $Container is not running. Start it with .\start.ps1 or docker compose up -d db." }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "$Database-$stamp.dump"
$inside = "/tmp/$name"
$dump = Invoke-Native { docker exec $Container pg_dump -U $user -d $Database -Fc -f $inside }
if (-not $dump.Ok) { Fail "pg_dump failed: $($dump.Output)" }
try {
    $check = Invoke-Native { docker exec $Container pg_restore --list $inside }
    if (-not $check.Ok) { Fail "The backup cannot be read back by pg_restore: $($check.Output)" }
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    $target = Join-Path $Dir $name
    $copy = Invoke-Native { docker cp "${Container}:$inside" $target }
    if (-not $copy.Ok) { Fail "Copying the backup out of the container failed: $($copy.Output)" }
} finally {
    Invoke-Native { docker exec $Container rm -f $inside } | Out-Null
}
Keep-Latest $Dir $Database $Keep
$size = '{0:N1} MB' -f ((Get-Item -LiteralPath $target).Length / 1MB)
Write-Host "   OK  $target ($size); the latest $Keep copies are kept" -ForegroundColor Green

if ($MirrorDir) {
    New-Item -ItemType Directory -Force -Path $MirrorDir | Out-Null
    Copy-Item -LiteralPath $target -Destination (Join-Path $MirrorDir $name) -Force
    Keep-Latest $MirrorDir $Database $Keep
    Write-Host "   OK  copied to $MirrorDir" -ForegroundColor Green
}
