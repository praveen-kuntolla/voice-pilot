param([switch]$KeepServer, [switch]$FocusedLogin)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$metadata = Join-Path $repo '.local\voicepilot-local-loopback-fixtures.json'
$fixtureScript = Join-Path $PSScriptRoot 'local-supabase-fixtures.ps1'
$server = $null
$serverLog = Join-Path $repo '.local\isolated-next.stdout.log'
$serverErrorLog = Join-Path $repo '.local\isolated-next.stderr.log'
function Get-DescendantProcessIds([int]$rootId) {
  $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add($rootId)
  $changed = $true
  while ($changed) { $changed = $false; foreach ($process in Get-CimInstance Win32_Process) { if ($ids.Contains([int]$process.ParentProcessId) -and -not $ids.Contains([int]$process.ProcessId)) { $ids.Add([int]$process.ProcessId); $changed = $true } } }
  return $ids
}
function Test-IsolatedServerOwner([int]$listenerPid, [int]$rootId) {
  if ((Get-DescendantProcessIds $rootId) -contains $listenerPid) { return $true }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerPid"
  if ($null -ne $process -and [string]$process.CommandLine -match 'start-isolated-auth-dev\.mjs|next(\.js)?\s+dev' -and [string]$process.CommandLine -match [regex]::Escape($repo)) { return $true }
  if ($null -ne $process -and [string]$process.CommandLine -match 'next[\\/]dist[\\/]bin[\\/]next.*dev.*--hostname\s+127\.0\.0\.1.*--port\s+3001') { return $true }
  if ($null -ne $process -and [string]$process.CommandLine -match 'next[\\/]dist[\\/]server[\\/]lib[\\/]start-server\.js') {
    $ancestor = $process
    while ($null -ne $ancestor -and [int]$ancestor.ParentProcessId -gt 0) {
      $ancestor = Get-CimInstance Win32_Process -Filter "ProcessId=$($ancestor.ParentProcessId)"
      if ($null -ne $ancestor -and [string]$ancestor.CommandLine -match 'start-isolated-auth-dev\.mjs') { return $true }
    }
  }
  $current = $process
  while ($null -ne $current -and [int]$current.ParentProcessId -gt 0) {
    if ([int]$current.ParentProcessId -eq $rootId) { return $true }
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ParentProcessId)"
  }
  return $false
}
try {
  $existing = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)
  if ($existing) { throw "Port 3001 is already occupied by PID $($existing[0].OwningProcess); refusing to reuse an unverified server." }
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
  Remove-Item $serverLog,$serverErrorLog -Force -ErrorAction SilentlyContinue
  $server = Start-Process -FilePath 'node' -ArgumentList 'scripts/start-isolated-auth-dev.mjs' -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrorLog
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    $listener = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)
    try { $health = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/health' -UseBasicParsing; $owned = $listener -and (Test-IsolatedServerOwner ([int]$listener[0].OwningProcess) $server.Id); if ($health.StatusCode -eq 200 -and $listener -and ($owned -or -not $server.HasExited)) { $ready = $true; break } } catch {}
    if ($server.HasExited) { throw "Isolated Next.js server exited before readiness. See local isolated server logs." }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'The isolated Next.js server did not become ready.' }
  $login = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/login' -UseBasicParsing
  if ($login.StatusCode -ne 200 -or $login.Content -notmatch 'Log in to your workspace') { throw 'The isolated login page did not compile correctly. See local isolated server logs.' }
  if ($FocusedLogin) { & npx playwright test tests/e2e/isolated-auth-flow.spec.ts --grep "persists a session" --workers=1 } else { & npx playwright test --workers=1 }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item Env:E2E_ISOLATED_AUTH,Env:E2E_EMAIL_A,Env:E2E_PASSWORD_A,Env:E2E_EMAIL_B,Env:E2E_PASSWORD_B,Env:E2E_EMAIL_C,Env:E2E_PASSWORD_C,Env:PLAYWRIGHT_BASE_URL,Env:PLAYWRIGHT_REUSE_EXISTING_SERVER,Env:PORT -ErrorAction SilentlyContinue
  if ($server -and -not $KeepServer) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  try { & $fixtureScript -Action cleanup | Out-Null } catch { Write-Error 'Fixture cleanup failed; inspect local fixture metadata before retrying.' }
}
