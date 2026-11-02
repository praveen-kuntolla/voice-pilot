# Phase 12D disposable PostgreSQL acceptance from Windows PowerShell

This is a review and execution guide for the existing disposable acceptance workflow. It does not create a production connection, apply migrations to a remote project, issue LiveKit tokens, or enable providers.

## Prerequisites

Install or make available to the same PowerShell session:

- Windows 10/11 with Docker Desktop using the Linux/WSL2 engine, Docker Compose v2, and enough disk/RAM for the Supabase stack.
- Node.js 24 and npm. The CI workflow uses `actions/setup-node` with Node 24 and `npm ci`.
- The official Supabase CLI. The repository workflow invokes it through `npx supabase`; a standalone `supabase` executable is also acceptable if it is the same supported release.
- PostgreSQL client tools: `psql`, `createdb`, `dropdb`, and `pg_dump` on `PATH`. The database-backed scripts create randomized databases and exercise real transactions.
- PowerShell 7 is recommended. Git Bash or WSL is useful for reproducing the workflow's Bash-only pipe and environment-file behavior, but is not a substitute for Docker Desktop's Linux engine.

Verify without printing credentials:

```powershell
Set-Location 'C:\Users\PC\Documents\ChatGPT\voicepilot-livekit-codex'
docker version
docker info
npx supabase --version
node --version
npm --version
psql --version
createdb --version
dropdb --version
pg_dump --version
Get-Command docker,npx,psql,createdb,dropdb,pg_dump
```

The repository must be run against loopback only. Do not set `NEXT_PUBLIC_SUPABASE_URL`, `GATEWAY_DATABASE_URL`, or `DB_URL` to a `.supabase.co` host or to the production project reference `xegmtbkxcynxpioifdxh`.

## What CI does

`.github/workflows/pr20-offline-quality.yml`, job `authenticated-voice-postgres-e2e`, is the authoritative disposable flow. It:

1. Starts Supabase with `npx supabase start`.
2. Reads `npx supabase status -o env` and keeps the local API URL, anonymous key, service-role key, and database URL in the runner environment.
3. Sets all provider and connectivity gates false, including `VOICE_REALTIME_ENABLED`, `VOICE_OUTBOUND_ENABLED`, `VOICE_PROVIDER_ACTIVATION_ENABLED`, and `VOICE_CONNECTIVITY_TEST_ENABLED`.
4. Runs `node scripts/ci-authenticated-voice-fixtures.mjs setup`. That script requires a loopback `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CI_E2E_FIXTURE_STATE`, and a protected `GITHUB_ENV` file. It creates random synthetic Auth users, organization, membership, agent, contact, and campaign records; it never uses customer data.
5. Creates a random gateway database, clones the local schema with `pg_dump` while excluding `vault.secrets` data, and verifies the three voice authorization RPCs.
6. Builds the app, starts it on `127.0.0.1:3100`, and runs `tests/e2e/phase-12b-authenticated-voice-session.spec.ts` with one Playwright worker.
7. Deletes synthetic fixtures, drops the random gateway database, checks that no fixture state remains, and runs `npx supabase stop --no-backup`.

The CI fixture generator is not interchangeable with `scripts/local-supabase-fixtures.ps1`: the former writes a protected CI environment file, while the latter writes `.local\voicepilot-local-loopback-fixtures.json` for the repository's 55421 loopback harness.

## Windows execution

Start Docker Desktop and wait until `docker info` succeeds. Then install dependencies and start the disposable Supabase stack:

```powershell
npm ci
npx supabase start
npx supabase status -o env | Set-Content -Encoding utf8 '.local\supabase-status.env'
```

Treat `.local\supabase-status.env` as secret-bearing local test material. Do not paste it into chat or commit it. The values needed by the tests are `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, and `DB_URL`. Import them into the current process using the CLI's documented output or an approved local helper; do not hard-code keys. Before proceeding, assert that `API_URL` begins with `http://127.0.0.1:` and that `DB_URL` resolves to the local Docker database.

The CI fixture script intentionally requires `GITHUB_ENV`. For a local PowerShell run, create a temporary, untracked environment-file path and export only the synthetic values written by the script:

```powershell
$env:CI = 'true'
$env:NODE_ENV = 'test'
$env:VOICE_SESSION_POSTGRES_DISPOSABLE = 'true'
$env:VOICE_OFFLINE_ADMISSION_TEST_ENABLED = 'true'
$env:VOICE_OFFLINE_ADMISSION_CI = 'true'
$env:VOICE_OFFLINE_ADMISSION_DIAGNOSTICS = 'true'
$env:VOICE_REALTIME_ENABLED = 'false'
$env:VOICE_OUTBOUND_ENABLED = 'false'
$env:VOICE_PROVIDER_ACTIVATION_ENABLED = 'false'
$env:VOICE_CONNECTIVITY_TEST_ENABLED = 'false'
$env:CI_E2E_FIXTURE_STATE = Join-Path (Get-Location) '.local\ci-fixtures.json'
$env:GITHUB_ENV = Join-Path $env:TEMP "voicepilot-github-env-$([guid]::NewGuid().ToString('N')).env"
node scripts/ci-authenticated-voice-fixtures.mjs setup
```

Import only the generated `CI_E2E_*` lines into the current PowerShell process after inspecting the file locally. Never print the password. If the script refuses to run because the local Supabase URL is not loopback, stop and correct the target rather than weakening the guard.

For a gateway clone, use a fresh randomized database and the local `DB_URL`; do not reuse a named database or a remote URL. The CI workflow is the reference for the exact `pg_dump --no-owner --no-privileges --no-comments --exclude-table-data=vault.secrets` and restore sequence. On Windows, run that sequence in Git Bash/WSL if PowerShell redirection changes the dump encoding, or use equivalent `pg_dump`/`psql` invocations without exposing output. Set `GATEWAY_DATABASE_URL` only to the newly created local gateway database and verify the required RPCs before running application tests.

## Database-backed checks

Run these only after the database target has passed the loopback and disposable-volume checks in the scripts:

```powershell
node scripts/test-session-admission-linux.mjs
node scripts/test-production-gateway.mjs
node scripts/test-transactional-safety.mjs
node scripts/local-rls-test.mjs
npx vitest run tests/postgres-voice-session-adapter.integration.test.ts
npx playwright test tests/e2e/phase-12b-authenticated-voice-session.spec.ts --workers=1
```

The first script creates and drops its own randomized PostgreSQL database and covers crash rollback, replay, revoke/consume races, audit-failure rollback, database-unavailable failure, atomic concurrency, idempotent release, usage limits, and emergency stop. The gateway and adapter tests require `GATEWAY_DATABASE_URL` and synthetic identity variables. The isolated RLS, transactional, and production-gateway scripts refuse unexpected containers, volumes, ports, migration ledgers, or non-loopback endpoints. These checks exercise real SQL transactions, row locks, RLS, concurrency limits, and release operations; they do not issue LiveKit tokens or connect to providers.

Then run the ordinary offline checks:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Run the client bundle scan when a production build and its isolated test configuration are available:

```powershell
node scripts/check-livekit-client-bundle.mjs
```

Keep the LiveKit test configuration absent or provider-disabled for this acceptance. Do not run `scripts/run-isolated-livekit-next.mjs` or any connectivity test as part of this database preparation.

## Existing 55421 Windows loopback harness

The repository also contains a separate, pre-existing loopback Compose harness used by `scripts/local-supabase-fixtures.ps1`, `scripts/apply-isolated-local-migrations.ps1`, `scripts/local-rls-test.mjs`, and related scripts. It expects an approved `.local\supabase-loopback-source\docker` checkout, its `.env`, and `SUPABASE_PUBLIC_URL=http://127.0.0.1:55421`; it uses ports 55421–55423 and dedicated loopback Docker state. Those missing files are not credentials and must not be fabricated. Obtain the approved local Supabase source/Compose bundle or use the official CLI-generated stack.

When that harness is present and Docker checks pass:

```powershell
& .\scripts\apply-isolated-local-migrations.ps1
& .\scripts\local-supabase-fixtures.ps1 -Action setup
node scripts/local-rls-test.mjs
& .\scripts\local-supabase-fixtures.ps1 -Action cleanup
```

Apply migrations only to this disposable, loopback database. Never run these commands after linking the CLI to a project or against a production Supabase URL.

## Cleanup

Always clean synthetic state before stopping the stack. If setup completed, run:

```powershell
node scripts/ci-authenticated-voice-fixtures.mjs cleanup
npx supabase stop --no-backup
Remove-Item -LiteralPath $env:CI_E2E_FIXTURE_STATE -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $env:GITHUB_ENV -Force -ErrorAction SilentlyContinue
```

Drop only the randomized gateway database created for this run, verify it is absent, and remove the temporary status file. For the 55421 harness use `local-supabase-fixtures.ps1 -Action cleanup` before stopping Docker. Do not use `docker system prune`, broad volume deletion, or commands that can affect unrelated projects.

## Current blockers in this workspace

At preparation time this workspace has no Docker CLI, no standalone Supabase CLI, no `.local\supabase-loopback-source\docker` Compose bundle or `.env`, and no synthetic fixture state. `npx supabase --version` also failed because the sandbox could not write the Supabase telemetry file under `C:\Users\PC\.supabase` (`EPERM`). Therefore no disposable PostgreSQL database, real transaction acceptance, RLS check, concurrency check, or cleanup run is claimed here. Install/start the local prerequisites and rerun the commands above; do not replace the blocked database run with mocks or fabricated fixture values.
