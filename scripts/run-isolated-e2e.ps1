param([switch]$KeepServer, [ValidateSet('all','login','voice')][string]$TestSelection = 'all', [ValidateSet('dev','production')][string]$Runtime = 'production', [ValidateRange(1024,65535)][int]$ServerPort = 3001)
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
  return (Get-DescendantProcessIds $rootId) -contains $listenerPid
}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Net;
using System.Runtime.InteropServices;
public static class VoicePilotTcpOwnerTable {
  [DllImport("iphlpapi.dll", SetLastError = true)]
  static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool ordered, int family, int tableClass, uint reserved);
  public static string[] ListLoopbackListeners(int port) {
    int size = 0;
    GetExtendedTcpTable(IntPtr.Zero, ref size, true, 2, 3, 0); // IPv4, TCP_TABLE_OWNER_PID_LISTENER
    if (size <= 0) return Array.Empty<string>();
    IntPtr buffer = Marshal.AllocHGlobal(size);
    try {
      if (GetExtendedTcpTable(buffer, ref size, true, 2, 3, 0) != 0) return Array.Empty<string>();
      var results = new List<string>();
      int count = Marshal.ReadInt32(buffer);
      for (int i = 0; i < count; i++) {
        int row = 4 + i * 24; // MIB_TCPROW_OWNER_PID: six DWORDs
        int address = Marshal.ReadInt32(buffer, row + 4);
        int rawPort = Marshal.ReadInt32(buffer, row + 8);
        int localPort = ((rawPort & 255) << 8) | ((rawPort >> 8) & 255);
        if (localPort == port && new IPAddress(BitConverter.GetBytes(address)).ToString() == "127.0.0.1") {
          results.Add(Marshal.ReadInt32(buffer, row + 20).ToString());
        }
      }
      return results.ToArray();
    } finally { Marshal.FreeHGlobal(buffer); }
  }
}
'@
function Get-ListeningSockets {
  $sockets = [System.Collections.Generic.List[object]]::new()
  try {
    foreach ($connection in @(Get-NetTCPConnection -LocalPort $ServerPort -State Listen -ErrorAction Stop | Where-Object { $_.LocalAddress -eq '127.0.0.1' })) {
      $sockets.Add([pscustomobject]@{ Address = '127.0.0.1'; Port = $ServerPort; OwningProcess = [int]$connection.OwningProcess; Method = 'Get-NetTCPConnection' })
    }
  } catch {}
  if ($sockets.Count -eq 0) {
    try {
      foreach ($line in @(netstat.exe -ano -p tcp 2>$null)) {
        if ($line -match "^\s*TCP\s+127\.0\.0\.1:$ServerPort\s+\S+\s+LISTENING\s+(\d+)\s*$") {
          $sockets.Add([pscustomobject]@{ Address = '127.0.0.1'; Port = $ServerPort; OwningProcess = [int]$Matches[1]; Method = 'netstat' })
        }
      }
    } catch {}
  }
  if ($sockets.Count -eq 0) {
    foreach ($listenerPid in [VoicePilotTcpOwnerTable]::ListLoopbackListeners($ServerPort)) {
      $sockets.Add([pscustomobject]@{ Address = '127.0.0.1'; Port = $ServerPort; OwningProcess = [int]$listenerPid; Method = 'GetExtendedTcpTable' })
    }
  }
  return $sockets
}
try {
  $existing = @(Get-ListeningSockets)
  if ($existing) { throw "Port $ServerPort is already occupied by PID $($existing[0].OwningProcess); refusing to reuse an unverified server." }
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
  $env:PORT = [string]$ServerPort; $env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:$ServerPort"; $env:PLAYWRIGHT_REUSE_EXISTING_SERVER = 'true'
  if ($Runtime -eq 'production') {
    & node scripts/start-isolated-auth-dev.mjs build | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path '.next-e2e/BUILD_ID')) { throw 'The isolated local production build failed.' }
  }
  Remove-Item $serverLog,$serverErrorLog -Force -ErrorAction SilentlyContinue
  $server = Start-Process -FilePath 'node' -ArgumentList @('scripts/start-isolated-auth-dev.mjs', $(if ($Runtime -eq 'production') { 'start' } else { 'dev' })) -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrorLog
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try { $health = Invoke-WebRequest -Uri "http://127.0.0.1:$ServerPort/api/health" -UseBasicParsing; foreach ($listener in @(Get-ListeningSockets)) { if ($health.StatusCode -eq 200 -and (Test-IsolatedServerOwner ([int]$listener.OwningProcess) $server.Id)) { $ready = $true; break } }; if ($ready) { break } } catch {}
    if ($server.HasExited) { throw "Isolated Next.js server exited before readiness. See local isolated server logs." }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { $diagnosticSockets = @(Get-ListeningSockets | ForEach-Object { "$($_.Method):$($_.Address):$($_.Port):PID=$($_.OwningProcess)" }); throw "The isolated Next.js server did not become ready. Listener diagnostics: $($diagnosticSockets -join '; ') Root PID: $($server.Id)." }
  $login = Invoke-WebRequest -Uri "http://127.0.0.1:$ServerPort/login" -UseBasicParsing
  if ($login.StatusCode -ne 200 -or $login.Content -notmatch 'Log in to your workspace') { throw 'The isolated login page did not compile correctly. See local isolated server logs.' }
  if ($TestSelection -eq 'login') { & npx playwright test tests/e2e/isolated-auth-flow.spec.ts --grep "persists a session" --workers=1 }
  elseif ($TestSelection -eq 'voice') { & npx playwright test tests/e2e/public-smoke.spec.ts --grep "local voice simulator is opt-in" --workers=1 }
  else { & npx playwright test --workers=1 }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item Env:E2E_ISOLATED_AUTH,Env:E2E_EMAIL_A,Env:E2E_PASSWORD_A,Env:E2E_EMAIL_B,Env:E2E_PASSWORD_B,Env:E2E_EMAIL_C,Env:E2E_PASSWORD_C,Env:PLAYWRIGHT_BASE_URL,Env:PLAYWRIGHT_REUSE_EXISTING_SERVER,Env:PORT -ErrorAction SilentlyContinue
  if ($server -and -not $KeepServer) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  try { & $fixtureScript -Action cleanup | Out-Null } catch { Write-Error 'Fixture cleanup failed; inspect local fixture metadata before retrying.' }
}
