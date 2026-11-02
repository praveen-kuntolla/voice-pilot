param(
  [switch]$SkipServices,
  [switch]$GatewayAware,
  [int]$Port = 3100
)

if ($GatewayAware) {
  & node (Join-Path $PSScriptRoot 'start-gateway-aware-local-demo.mjs') '--port' ([string]$Port) $(if ($SkipServices) { '--skip-services' })
  exit $LASTEXITCODE
}

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $repo '.local'
$source = Join-Path $localRoot 'supabase-loopback-source'
$approvedSource = 'C:\Users\PC\Documents\ChatGPT\voicepilot-ai\.local\supabase-loopback-source'
$composeFile = Join-Path $source 'docker\docker-compose.yml'
$composeEnv = Join-Path $source 'docker\.env'
$fixtureScript = Join-Path $PSScriptRoot 'local-supabase-fixtures.ps1'
$metadata = Join-Path $localRoot 'voicepilot-local-loopback-fixtures.json'
$server = $null
$fixturesReady = $false
$servicesStarted = $false
$junctionCreated = $false

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required command is unavailable: $Name" }
}

function Cleanup {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  if ($fixturesReady) { & $fixtureScript -Action cleanup | Out-Null; $script:fixturesReady = $false }
  if ($servicesStarted) {
    docker compose --project-name voicepilot-local-loopback --file $composeFile --env-file $composeEnv down | Out-Null
    $script:servicesStarted = $false
  }
  if ($junctionCreated -and (Test-Path -LiteralPath $source)) {
    Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue
    $script:junctionCreated = $false
  }
}

try {
  Assert-Command 'docker'
  Assert-Command 'node'
  if (-not (Test-Path -LiteralPath $source) -and (Test-Path -LiteralPath $approvedSource)) {
    New-Item -ItemType Junction -Path $source -Target $approvedSource | Out-Null
    $junctionCreated = $true
  }
  if (-not (Test-Path -LiteralPath $composeFile) -or -not (Test-Path -LiteralPath $composeEnv)) {
    throw "Approved loopback Supabase bundle is missing. Expected .local\supabase-loopback-source\docker\docker-compose.yml and .env."
  }
  $dockerInfo = docker info --format '{{.ServerVersion}}' 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dockerInfo)) { throw 'Docker daemon is unavailable. Start Docker Desktop and retry.' }
  $envLines = Get-Content -LiteralPath $composeEnv
  $publicUrl = ($envLines | Where-Object { $_ -match '^SUPABASE_PUBLIC_URL=' }) -replace '^SUPABASE_PUBLIC_URL=', ''
  if ($publicUrl -ne 'http://127.0.0.1:55421') { throw 'Refusing to run: Supabase endpoint is not the approved loopback URL.' }
  if (-not $SkipServices) {
    docker compose --project-name voicepilot-local-loopback --file $composeFile --env-file $composeEnv up -d
    if ($LASTEXITCODE -ne 0) { throw 'Unable to start the approved loopback Supabase project.' }
    $servicesStarted = $true
  }
  & $fixtureScript -Action setup | Out-Null
  if (-not (Test-Path -LiteralPath $metadata)) { throw 'Synthetic fixture provisioning did not produce metadata.' }
  $fixturesReady = $true
  $env:PORT = [string]$Port
  $env:NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55421'
  $env:VOICE_WORKER_ENABLED = 'false'
  $env:VOICE_REALTIME_ENABLED = 'false'
  $env:VOICE_OUTBOUND_ENABLED = 'false'
  $env:VOICE_PROVIDER_ACTIVATION_ENABLED = 'false'
  $env:VOICE_PROVIDER_MODE = 'mock'
  $server = Start-Process -FilePath 'node' -ArgumentList @((Join-Path $PSScriptRoot 'start-isolated-auth-dev.mjs'), 'dev') -WorkingDirectory $repo -PassThru -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    try { if ((Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready = $true; break } } catch {}
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "Next.js demo server did not become ready at http://127.0.0.1:$Port." }
  Write-Output "OUTLIVO local demo: http://127.0.0.1:$Port"
  Write-Output 'Synthetic fixtures are active for this process. Press Ctrl+C to clean up.'
  Wait-Process -Id $server.Id
} finally {
  Cleanup
}
