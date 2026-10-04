<#
.SYNOPSIS
  Stop FinAlly (Windows PowerShell). Removes the container but keeps the data volume.
  Idempotent: safe to run when nothing is running.
#>
[CmdletBinding()]
param()

# Native docker commands write progress to stderr; under 'Stop' Windows PowerShell 5.1
# would turn that into terminating errors. We check $LASTEXITCODE explicitly instead.
$ErrorActionPreference = 'Continue'

$ContainerName = if ($env:FINALLY_CONTAINER) { $env:FINALLY_CONTAINER } else { 'finally' }
$VolumeName    = if ($env:FINALLY_VOLUME) { $env:FINALLY_VOLUME } else { 'finally-data' }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error 'docker is not installed or not on PATH.'
    exit 1
}

& docker container inspect $ContainerName 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Stopping and removing container '$ContainerName'..."
    & docker rm -f $ContainerName 2>&1 | Out-Null
    Write-Host "Stopped. Data volume '$VolumeName' was kept."
} else {
    Write-Host "Container '$ContainerName' is not running. Nothing to do."
}
# Explicit success: otherwise $LASTEXITCODE leaks the failed 'docker inspect' (1) to callers.
exit 0
