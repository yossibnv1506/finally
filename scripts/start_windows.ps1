<#
.SYNOPSIS
  Start FinAlly in Docker (Windows PowerShell). Idempotent: safe to run repeatedly.
.EXAMPLE
  .\scripts\start_windows.ps1            # build if needed, run, open browser
  .\scripts\start_windows.ps1 -Build     # force rebuild of the image
  .\scripts\start_windows.ps1 -NoOpen    # do not open the browser
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$NoOpen
)

# Native docker commands write progress to stderr; under 'Stop' Windows PowerShell 5.1
# would turn that into terminating errors. We check $LASTEXITCODE explicitly instead.
$ErrorActionPreference = 'Continue'

$ImageName     = 'finally'
$ContainerName = if ($env:FINALLY_CONTAINER) { $env:FINALLY_CONTAINER } else { 'finally' }
$VolumeName    = if ($env:FINALLY_VOLUME) { $env:FINALLY_VOLUME } else { 'finally-data' }
$Port          = if ($env:FINALLY_PORT) { $env:FINALLY_PORT } else { '8000' }
$Url           = "http://localhost:$Port"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error 'docker is not installed or not on PATH.'
    exit 1
}

& docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error 'The Docker daemon is not running. Start Docker Desktop and retry.'
    exit 1
}

$EnvFile = Join-Path $ProjectRoot '.env'
$EnvExample = Join-Path $ProjectRoot '.env.example'
if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExample) {
        Copy-Item $EnvExample $EnvFile
        Write-Host 'Created .env from .env.example - edit it to add your OPENROUTER_API_KEY.'
    } else {
        Write-Error "Neither .env nor .env.example found in $ProjectRoot."
        exit 1
    }
}

& docker image inspect $ImageName 2>&1 | Out-Null
$ImageExists = ($LASTEXITCODE -eq 0)
if ($Build -or -not $ImageExists) {
    Write-Host "Building Docker image '$ImageName'..."
    & docker build -t $ImageName .
    if ($LASTEXITCODE -ne 0) { Write-Error 'docker build failed.'; exit 1 }
}

& docker container inspect $ContainerName 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Removing existing container '$ContainerName'..."
    & docker rm -f $ContainerName 2>&1 | Out-Null
}

Write-Host "Starting container '$ContainerName'..."
& docker run -d `
    --name $ContainerName `
    -v "${VolumeName}:/app/db" `
    -p "${Port}:8000" `
    --env-file $EnvFile `
    $ImageName | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error 'docker run failed.'; exit 1 }

# Wait for /api/health before reporting (cold start takes ~10s), even with -NoOpen.
$WaitSecs = if ($env:FINALLY_WAIT_SECS) { [int]$env:FINALLY_WAIT_SECS } else { 60 }
$Ready = $false
for ($i = 0; $i -lt $WaitSecs; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $Ready = $true; break }
    } catch { }
    $running = (& docker inspect -f '{{.State.Running}}' $ContainerName 2>$null)
    if ($running -ne 'true') { break }
    Start-Sleep -Seconds 1
}

Write-Host ''
if ($Ready) {
    Write-Host "FinAlly is running at $Url"
} else {
    $running = (& docker inspect -f '{{.State.Running}}' $ContainerName 2>$null)
    if ($running -ne 'true') {
        Write-Error "Container '$ContainerName' exited during startup. Check: docker logs $ContainerName"
        exit 1
    }
    Write-Warning "FinAlly did not report healthy within ${WaitSecs}s; it may still be starting. Check: docker logs $ContainerName"
    Write-Host "URL: $Url"
}
Write-Host "Stop it with: .\scripts\stop_windows.ps1  (data in volume '$VolumeName' is kept)"

if (-not $NoOpen) {
    Start-Process $Url
}
exit 0
