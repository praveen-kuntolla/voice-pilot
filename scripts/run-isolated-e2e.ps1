param([switch]$KeepServer)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$metadata = Join-Path $repo '.local\voicepilot-local-loopback-fixtures.json'
$fixtureScript = Join-Path $PSScriptRoot 'local-supabase-fixtures.ps1'
$server = $null
try {
  $compose = docker compose -p voicepilot-local-loopback ps --format json | ConvertFrom-Json
  if (-not $compose) { throw 'The isolated Compose project is not running.' }
  $published = @($compose | Where-Object { $_.Publishers -and $_.Publishers -match '127\.0\.0\.1' })
  if (-not ($published | Where-Object { $_.Service -eq 'api-gw' -and $_.Publishers -match '55421' })) { throw 'The isolated API is not published on 127.0.0.1:55421.' }
  if (-not ($published | Where-Object { $_.Service -eq 'supavisor' -and $_.Publishers -match '55422' })) { throw 'The isolated PostgreSQL pooler is not published on 127.0.0.1:55422.' }
  $db = docker compose -p voicepilot-local-loopback ps -q db
  $versions = docker exec $db psql -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations order by version;"
  $expected = 1..11 | ForEach-Object { '202610220{0:D3}' -f $_ }
  if ((@($versions) -join ',') -ne ($expected -join ',')) { throw 'Local migration ledger is not exactly 001-011.' }
  & $fixtureScript -Action setup | Out-Null
  if (-not (Test-Path $metadata)) { throw 'Fixture metadata was not created.' }
  $fixture = Get-Content $metadata -Raw | ConvertFrom-Json
  $env:E2E_ISOLATED_AUTH = 'true'
  $env:E2E_EMAIL_A = [string]$fixture.users[0].email; $env:E2E_PASSWORD_A = [string]$fixture.users[0].password
  $env:E2E_EMAIL_B = [string]$fixture.users[1].email; $env:E2E_PASSWORD_B = [string]$fixture.users[1].password
  $env:E2E_EMAIL_C = [string]$fixture.users[2].email; $env:E2E_PASSWORD_C = [string]$fixture.users[2].password
  $env:PORT = '3001'; $env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3001'; $env:PLAYWRIGHT_REUSE_EXISTING_SERVER = 'true'
  $server = Start-Process -FilePath 'node' -ArgumentList 'scripts/start-isolated-auth-dev.mjs' -WorkingDirectory $repo -PassThru -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) { try { $health = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/health' -UseBasicParsing; if ($health.StatusCode -eq 200) { $ready = $true; break } } catch {} Start-Sleep -Milliseconds 500 }
  if (-not $ready) { throw 'The isolated Next.js server did not become ready.' }
  & npx playwright test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item Env:E2E_ISOLATED_AUTH,Env:E2E_EMAIL_A,Env:E2E_PASSWORD_A,Env:E2E_EMAIL_B,Env:E2E_PASSWORD_B,Env:E2E_EMAIL_C,Env:E2E_PASSWORD_C,Env:PLAYWRIGHT_BASE_URL,Env:PLAYWRIGHT_REUSE_EXISTING_SERVER,Env:PORT -ErrorAction SilentlyContinue
  if ($server -and -not $KeepServer) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  try { & $fixtureScript -Action cleanup | Out-Null } catch { Write-Error 'Fixture cleanup failed; inspect local fixture metadata before retrying.' }
}
