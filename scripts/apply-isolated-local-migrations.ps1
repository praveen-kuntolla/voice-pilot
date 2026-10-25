param(
  [string]$ComposeProject = 'voicepilot-local-loopback',
  [string]$ComposeDirectory = (Join-Path $PSScriptRoot '..\.local\supabase-loopback-source\docker')
)

$ErrorActionPreference = 'Stop'

$docker = 'C:\Users\PC\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
if (-not (Test-Path -LiteralPath $docker)) {
  throw 'Docker Desktop CLI was not found at the approved local path.'
}

$composeDirectory = [IO.Path]::GetFullPath($ComposeDirectory)
$composeFile = Join-Path $composeDirectory 'docker-compose.yml'
$envFile = Join-Path $composeDirectory '.env'
if (-not (Test-Path -LiteralPath $composeFile) -or -not (Test-Path -LiteralPath $envFile)) {
  throw 'The approved isolated Compose configuration is missing.'
}

$previousPath = $env:Path
$env:Path = "$(Split-Path -Parent $docker);$previousPath"

function Invoke-IsolatedPsql {
  param([Parameter(Mandatory)][string]$Sql)

  $Sql | & $docker compose --project-name $ComposeProject --env-file $envFile -f $composeFile exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) {
    throw "Direct isolated PostgreSQL command failed with exit code $LASTEXITCODE."
  }
}

try {
  $dbId = (& $docker ps -q --filter "label=com.docker.compose.project=$ComposeProject" --filter 'label=com.docker.compose.service=db').Trim()
  if ([string]::IsNullOrWhiteSpace($dbId)) {
    throw 'The isolated database container is not running.'
  }

  $mounts = (& $docker inspect $dbId --format '{{json .Mounts}}' | ConvertFrom-Json)
  if ($mounts.Name -contains 'supabase_db_voicepilot-ai' -or $mounts.Name -notcontains 'voicepilot-local-loopback-db') {
    throw 'Refusing to run: the database container does not have the dedicated local volume configuration.'
  }

  Invoke-IsolatedPsql @'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[] not null default array[]::text[],
  name text
);
'@

  $migrations = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\supabase\migrations') -Filter '*.sql' -File |
    Sort-Object Name

  foreach ($migration in $migrations) {
    if ($migration.Name -notmatch '^(?<version>\d+)_(?<name>.+)\.sql$') {
      throw "Unsupported migration filename: $($migration.Name)"
    }

    $version = $Matches.version
    $name = $Matches.name
    $quotedVersion = $version.Replace("'", "''")
    $quotedName = $name.Replace("'", "''")
    $existsSql = "select exists(select 1 from supabase_migrations.schema_migrations where version = '$quotedVersion');"
    $alreadyApplied = (& $docker compose --project-name $ComposeProject --env-file $envFile -f $composeFile exec -T db psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d postgres -c $existsSql).Trim()
    if ($LASTEXITCODE -ne 0) {
      throw "Could not read the isolated migration ledger for $($migration.Name)."
    }
    if ($alreadyApplied -eq 't') {
      Write-Output "SKIP $($migration.Name) (already recorded)"
      continue
    }

    if ((Get-Content -LiteralPath $migration.FullName -Raw) -match '(?im)^\s*create\s+index\s+concurrently\b') {
      throw "Migration $($migration.Name) uses CREATE INDEX CONCURRENTLY and cannot be safely wrapped in this atomic runner."
    }

    $body = Get-Content -LiteralPath $migration.FullName -Raw
    $sql = "begin;`n$body`ninsert into supabase_migrations.schema_migrations(version, name) values ('$quotedVersion', '$quotedName');`ncommit;"
    try {
      Invoke-IsolatedPsql -Sql $sql
      Write-Output "APPLIED $($migration.Name)"
    } catch {
      throw "Migration $($migration.Name) failed and was rolled back. $($_.Exception.Message)"
    }
  }
} finally {
  $env:Path = $previousPath
}
