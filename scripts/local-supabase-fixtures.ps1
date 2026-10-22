param(
  [ValidateSet('setup','cleanup')]
  [string]$Action = 'setup'
)

$ErrorActionPreference = 'Stop'
$productionRef = 'xegmtbkxcynxpioifdxh'
$metadataPath = Join-Path ([IO.Path]::GetTempPath()) 'voicepilot-local-fixtures.json'

function Get-LocalStatus {
  $status = npx.cmd supabase status -o json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read local Supabase status.' }
  $apiUrl = [string]$status.API_URL
  if ([string]::IsNullOrWhiteSpace($apiUrl) -or $apiUrl -notmatch '^https?://(127\.0\.0\.1|localhost):\d+$') {
    throw 'Refusing to continue: Supabase API URL is not local.'
  }
  if ($apiUrl -match '\.supabase\.co' -or (Test-Path 'supabase/.temp/project-ref') -and ((Get-Content 'supabase/.temp/project-ref' -Raw).Trim() -eq $productionRef)) {
    throw 'Refusing to continue: a remote Supabase project was detected.'
  }
  return $status
}

function Invoke-LocalAdmin {
  param([string]$Method, [string]$Path, [object]$Body, $Status)
  $headers = @{ apikey = [string]$Status.SERVICE_ROLE_KEY; Authorization = "Bearer $([string]$Status.SERVICE_ROLE_KEY)" }
  $params = @{ Uri = "$([string]$Status.API_URL)$Path"; Method = $Method; Headers = $headers; ContentType = 'application/json' }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
  return Invoke-RestMethod @params
}

$status = Get-LocalStatus

if ($Action -eq 'cleanup') {
  if (-not (Test-Path $metadataPath)) { Write-Output 'No local fixture metadata found.'; exit 0 }
  $fixture = Get-Content $metadataPath -Raw | ConvertFrom-Json
  foreach ($table in @('campaigns','contacts','agents','organization_members','organizations')) {
    if ($table -eq 'organization_members') { continue }
    $ids = @($fixture.ids.$table)
    foreach ($id in $ids) {
      if ($id) { Invoke-LocalAdmin -Method 'Delete' -Path ('/rest/v1/{0}?id=eq.{1}' -f $table, $id) -Body $null -Status $status | Out-Null }
    }
  }
  foreach ($userId in @($fixture.users.id)) {
    if ($userId) { Invoke-LocalAdmin -Method 'Delete' -Path "/auth/v1/admin/users/$userId" -Body $null -Status $status | Out-Null }
  }
  Remove-Item -LiteralPath $metadataPath -Force
  Write-Output 'Local fixtures cleaned up.'
  exit 0
}

if (Test-Path $metadataPath) { & $PSCommandPath -Action cleanup | Out-Null }
$passwordA = 'VpE2!' + ([Guid]::NewGuid().ToString('N').Substring(0, 20))
$passwordB = 'VpE2!' + ([Guid]::NewGuid().ToString('N').Substring(0, 20))
$emailA = 'voicepilot.e2e.a@example.test'
$emailB = 'voicepilot.e2e.b@example.test'

$userA = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailA; password = $passwordA; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E A' } } -Status $status
$userB = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailB; password = $passwordB; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E B' } } -Status $status

function Insert-Local {
  param([string]$Table, [object]$Body)
  return Invoke-LocalAdmin -Method 'Post' -Path "/rest/v1/$Table" -Body $Body -Status $status
}

$orgA = [Guid]::NewGuid().ToString()
$orgB = [Guid]::NewGuid().ToString()
$agentA = [Guid]::NewGuid().ToString()
$agentB = [Guid]::NewGuid().ToString()
$contactA = [Guid]::NewGuid().ToString()
$campaignA = [Guid]::NewGuid().ToString()
Insert-Local 'organizations' @{ id=$orgA; name='E2E Workspace A'; industry='Testing'; country='IN'; timezone='Asia/Calcutta'; business_use_case='Local isolated tests'; created_by=$userA.id } | Out-Null
Insert-Local 'organizations' @{ id=$orgB; name='E2E Workspace B'; industry='Testing'; country='IN'; timezone='Asia/Calcutta'; business_use_case='Local isolated tests'; created_by=$userB.id } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgA; user_id=$userA.id; role='owner' } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgB; user_id=$userB.id; role='owner' } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgB; user_id=$userA.id; role='member' } | Out-Null
Insert-Local 'agents' @{ id=$agentA; organization_id=$orgA; name='E2E Agent A'; instructions='Local test agent'; language='en-US'; status='draft'; created_by=$userA.id } | Out-Null
Insert-Local 'agents' @{ id=$agentB; organization_id=$orgB; name='E2E Agent B'; instructions='Local test agent'; language='en-US'; status='draft'; created_by=$userB.id } | Out-Null
Insert-Local 'contacts' @{ id=$contactA; organization_id=$orgA; name='E2E Contact A'; email='contact-a@example.test'; phone='+15550000001'; consent_status='granted' } | Out-Null
Insert-Local 'campaigns' @{ id=$campaignA; organization_id=$orgA; agent_id=$agentA; name='E2E Campaign A'; status='draft'; timezone='UTC'; start_hour=9; end_hour=17; consent_required=$true; created_by=$userA.id } | Out-Null

@{
  api_url = [string]$status.API_URL
  users = @(
    @{ id=$userA.id; email=$emailA; password=$passwordA; organization_id=$orgA; agent_id=$agentA },
    @{ id=$userB.id; email=$emailB; password=$passwordB; organization_id=$orgB; agent_id=$agentB }
  )
  ids = @{
    organizations = @($orgA,$orgB)
    organization_members = @()
    agents = @($agentA,$agentB)
    contacts = @($contactA)
    campaigns = @($campaignA)
  }
} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $metadataPath -Encoding UTF8

Write-Output 'Local isolated fixtures created.'
Write-Output "Metadata: $metadataPath"
