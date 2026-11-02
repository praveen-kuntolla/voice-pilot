param(
  [ValidateSet('setup','cleanup')]
  [string]$Action = 'setup'
)

$ErrorActionPreference = 'Stop'
$localRoot = if ($env:VOICEPILOT_FIXTURE_ROOT) { $env:VOICEPILOT_FIXTURE_ROOT } else { Join-Path $PSScriptRoot '..\.local' }
$metadataPath = Join-Path $localRoot 'voicepilot-local-loopback-fixtures.json'
$composeEnvPath = Join-Path $PSScriptRoot '..\.local\supabase-loopback-source\docker\.env'

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
    if ($userId) {
      try { $owned = Invoke-LocalAdmin -Method 'Get' -Path ("/rest/v1/organizations?created_by=eq.{0}&select=id" -f $userId) -Body $null -Status $status } catch { if ($_.Exception.Message -match 'user_not_found') { $owned = @() } else { throw } }
      foreach ($organization in @($owned)) { if ($organization.id) { Invoke-LocalAdmin -Method 'Delete' -Path ("/rest/v1/organizations?id=eq.{0}" -f $organization.id) -Body $null -Status $status | Out-Null } }
    }
  }
  foreach ($userId in @($fixture.users.id)) {
    if ($userId) { try { Invoke-LocalAdmin -Method 'Delete' -Path "/auth/v1/admin/users/$userId" -Body $null -Status $status | Out-Null } catch { if ($_.Exception.Message -notmatch 'user_not_found') { throw } } }
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
$passwordD = 'Vp2D!' + ([Guid]::NewGuid().ToString('N').Substring(0, 20))
$passwordE = 'Vp2V!' + ([Guid]::NewGuid().ToString('N').Substring(0, 20))
$suffix = if ($env:VOICEPILOT_FIXTURE_SUFFIX) { "." + $env:VOICEPILOT_FIXTURE_SUFFIX } else { '' }
$emailA = "voicepilot.e2e.a$suffix@example.test"
$emailB = "voicepilot.e2e.b$suffix@example.test"
$emailC = "voicepilot.e2e.c$suffix@example.test"
$emailD = "voicepilot.e2e.d$suffix@example.test"
$emailE = "voicepilot.e2e.e$suffix@example.test"

$userA = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailA; password = $passwordA; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E A' } } -Status $status
$userB = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailB; password = $passwordB; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E B' } } -Status $status
$userC = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailC; password = $passwordC; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E C' } } -Status $status
$userD = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailD; password = $passwordD; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E Fresh' } } -Status $status
$userE = Invoke-LocalAdmin -Method 'Post' -Path '/auth/v1/admin/users' -Body @{ email = $emailE; password = $passwordE; email_confirm = $true; user_metadata = @{ full_name = 'VoicePilot E2E Viewer' } } -Status $status

function Insert-Local {
  param([string]$Table, [object]$Body)
  return Invoke-LocalAdmin -Method 'Post' -Path "/rest/v1/$Table" -Body $Body -Status $status
}

$orgA = [Guid]::NewGuid().ToString()
$orgB = [Guid]::NewGuid().ToString()
$agentA = [Guid]::NewGuid().ToString()
$agentB = [Guid]::NewGuid().ToString()
$contactA = [Guid]::NewGuid().ToString()
$contactEligible2 = [Guid]::NewGuid().ToString()
$contactUnknown = [Guid]::NewGuid().ToString()
$contactRevoked = [Guid]::NewGuid().ToString()
$contactOptedOut = [Guid]::NewGuid().ToString()
$contactB = [Guid]::NewGuid().ToString()
$campaignA = [Guid]::NewGuid().ToString()
$campaignB = [Guid]::NewGuid().ToString()
Insert-Local 'profiles' @{ id=$userA.id; full_name='VoicePilot E2E A' } | Out-Null
Insert-Local 'profiles' @{ id=$userB.id; full_name='VoicePilot E2E B' } | Out-Null
Insert-Local 'profiles' @{ id=$userC.id; full_name='VoicePilot E2E C' } | Out-Null
Insert-Local 'profiles' @{ id=$userE.id; full_name='VoicePilot E2E Viewer' } | Out-Null
Insert-Local 'organizations' @{ id=$orgA; name='E2E Workspace A'; industry='Testing'; country='IN'; timezone='Asia/Calcutta'; business_use_case='Local isolated tests'; created_by=$userA.id } | Out-Null
Insert-Local 'organizations' @{ id=$orgB; name='E2E Workspace B'; industry='Testing'; country='IN'; timezone='Asia/Calcutta'; business_use_case='Local isolated tests'; created_by=$userB.id } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgA; user_id=$userA.id; role='owner' } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgB; user_id=$userB.id; role='owner' } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgA; user_id=$userC.id; role='admin' } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgB; user_id=$userA.id; role='member' } | Out-Null
Insert-Local 'organization_members' @{ organization_id=$orgA; user_id=$userE.id; role='viewer' } | Out-Null
Insert-Local 'agents' @{ id=$agentA; organization_id=$orgA; name='E2E Agent A'; instructions='Local test agent'; language='en-US'; status='draft'; created_by=$userA.id } | Out-Null
Insert-Local 'agents' @{ id=$agentB; organization_id=$orgB; name='E2E Agent B'; instructions='Local test agent'; language='en-US'; status='draft'; created_by=$userB.id } | Out-Null
Insert-Local 'contacts' @{ id=$contactA; organization_id=$orgA; name='E2E Contact A'; email='contact-a@example.test'; phone='+15550000001'; consent_status='granted' } | Out-Null
Insert-Local 'contacts' @{ id=$contactEligible2; organization_id=$orgA; name='E2E Contact Eligible 2'; email='eligible-2@example.test'; phone='+15550000006'; consent_status='granted' } | Out-Null
Insert-Local 'contacts' @{ id=$contactUnknown; organization_id=$orgA; name='E2E Unknown Consent'; email='unknown@example.test'; phone='+15550000002'; consent_status='unknown' } | Out-Null
Insert-Local 'contacts' @{ id=$contactRevoked; organization_id=$orgA; name='E2E Revoked Consent'; email='revoked@example.test'; phone='+15550000003'; consent_status='revoked' } | Out-Null
Insert-Local 'contacts' @{ id=$contactOptedOut; organization_id=$orgA; name='E2E Opted Out'; email='opted-out@example.test'; phone='+15550000004'; consent_status='granted'; opted_out_at=(Get-Date).ToUniversalTime().ToString('o') } | Out-Null
Insert-Local 'contacts' @{ id=$contactB; organization_id=$orgB; name='E2E Other Tenant'; email='other@example.test'; phone='+15550000005'; consent_status='granted' } | Out-Null
Insert-Local 'campaigns' @{ id=$campaignA; organization_id=$orgA; agent_id=$agentA; name='E2E Campaign A'; status='draft'; timezone='UTC'; start_hour=9; end_hour=17; consent_required=$true; created_by=$userA.id } | Out-Null
Insert-Local 'campaigns' @{ id=$campaignB; organization_id=$orgB; agent_id=$agentB; name='E2E Campaign B'; status='draft'; timezone='UTC'; start_hour=9; end_hour=17; consent_required=$true; created_by=$userB.id } | Out-Null

@{
  api_url = [string]$status.API_URL
  users = @(
    @{ id=$userA.id; email=$emailA; password=$passwordA; organization_id=$orgA; agent_id=$agentA },
    @{ id=$userB.id; email=$emailB; password=$passwordB; organization_id=$orgB; agent_id=$agentB },
    @{ id=$userC.id; email=$emailC; password=$passwordC; organization_id=$orgA; agent_id=$agentA }
    @{ id=$userD.id; email=$emailD; password=$passwordD; organization_id=$null; agent_id=$null },
    @{ id=$userE.id; email=$emailE; password=$passwordE; organization_id=$orgA; agent_id=$agentA }
  )
  ids = @{
    organizations = @($orgA,$orgB)
    organization_members = @()
    agents = @($agentA,$agentB)
    contacts = @($contactA,$contactEligible2,$contactUnknown,$contactRevoked,$contactOptedOut,$contactB)
    campaigns = @($campaignA,$campaignB)
  }
} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $metadataPath -Encoding UTF8

Write-Output 'Local isolated fixtures created.'
Write-Output "Metadata: $metadataPath"
