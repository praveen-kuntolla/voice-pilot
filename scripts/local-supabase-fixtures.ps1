param(
  [ValidateSet('setup','cleanup')]
  [string]$Action = 'setup'
)

$ErrorActionPreference = 'Stop'
$localRoot = Join-Path $PSScriptRoot '..\.local'
$metadataPath = Join-Path $localRoot 'voicepilot-local-loopback-fixtures.json'
$composeEnvPath = Join-Path $localRoot 'supabase-loopback-source\docker\.env'

function Get-LocalStatus {
  if (-not (Test-Path -LiteralPath $composeEnvPath)) { throw 'Unable to find the isolated local Supabase configuration.' }
  $values = @{}
  Get-Content -LiteralPath $composeEnvPath | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
  }
  $apiUrl = [string]$values['SUPABASE_PUBLIC_URL']
  if ($apiUrl -ne 'http://127.0.0.1:55421') { throw 'Refusing to continue: the configured API URL is not the approved isolated loopback endpoint.' }
  if ([string]::IsNullOrWhiteSpace($values['ANON_KEY']) -or [string]::IsNullOrWhiteSpace($values['SERVICE_ROLE_KEY'])) {
    throw 'The isolated local Supabase API keys are unavailable.'
  }
  return [pscustomobject]@{ API_URL=$apiUrl; ANON_KEY=$values['ANON_KEY']; SERVICE_ROLE_KEY=$values['SERVICE_ROLE_KEY'] }
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
New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
$passwordA = 'VpE2!' + ([Guid]::NewGuid().ToString('N').Substring(0, 20))
$passwordB = 'VpE2!' + ([Guid]::NewGuid().ToString('N').Substring(0, 20))
$passwordC = 'VpE2!' + ([Guid]::NewGuid().ToString('N').Substring(0, 20))
$emailA = 'voicepilot.e2e.a@example.test'
$emailB = 'voicepilot.e2e.b@example.test'
$emailC = 'voicepilot.e2e.c@example.test'

$userA = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailA; password = $passwordA; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E A' } } -Status $status
$userB = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailB; password = $passwordB; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E B' } } -Status $status
$userC = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailC; password = $passwordC; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E C' } } -Status $status

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
Insert-Local 'profiles' @{ id=$userA.id; full_name='VoicePilot E2E A' } | Out-Null
Insert-Local 'profiles' @{ id=$userB.id; full_name='VoicePilot E2E B' } | Out-Null
Insert-Local 'profiles' @{ id=$userC.id; full_name='VoicePilot E2E C' } | Out-Null
Insert-Local 'organizations' @{ id=$orgA; name='E2E Workspace A'; industry='Testing'; country='IN'; timezone='Asia/Calcutta'; business_use_case='Local isolated tests'; created_by=$userA.id } | Out-Null
Insert-Local 'organizations' @{ id=$orgB; name='E2E Workspace B'; industry='Testing'; country='IN'; timezone='Asia/Calcutta'; business_use_case='Local isolated tests'; created_by=$userB.id } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgA; user_id=$userA.id; role='owner' } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgB; user_id=$userB.id; role='owner' } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgA; user_id=$userC.id; role='admin' } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgB; user_id=$userA.id; role='member' } | Out-Null
Insert-Local 'agents' @{ id=$agentA; organization_id=$orgA; name='E2E Agent A'; instructions='Local test agent'; language='en-US'; status='draft'; created_by=$userA.id } | Out-Null
Insert-Local 'agents' @{ id=$agentB; organization_id=$orgB; name='E2E Agent B'; instructions='Local test agent'; language='en-US'; status='draft'; created_by=$userB.id } | Out-Null
Insert-Local 'contacts' @{ id=$contactA; organization_id=$orgA; name='E2E Contact A'; email='contact-a@example.test'; phone='+15550000001'; consent_status='granted' } | Out-Null
Insert-Local 'campaigns' @{ id=$campaignA; organization_id=$orgA; agent_id=$agentA; name='E2E Campaign A'; status='draft'; timezone='UTC'; start_hour=9; end_hour=17; consent_required=$true; created_by=$userA.id } | Out-Null

@{
  api_url = [string]$status.API_URL
  users = @(
    @{ id=$userA.id; email=$emailA; password=$passwordA; organization_id=$orgA; agent_id=$agentA },
    @{ id=$userB.id; email=$emailB; password=$passwordB; organization_id=$orgB; agent_id=$agentB },
    @{ id=$userC.id; email=$emailC; password=$passwordC; organization_id=$orgA; agent_id=$agentA }
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
