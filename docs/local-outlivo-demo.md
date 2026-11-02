# OUTLIVO Local Demo

This workflow uses only the approved loopback Supabase project and synthetic fixtures. It does not use production credentials, create LiveKit rooms, capture microphone audio, dispatch workers, place calls, or contact providers.

## Prerequisites

- Docker Desktop with the Linux engine running.
- Node.js and repository dependencies installed.
- Approved bundle at `.local/supabase-loopback-source/docker/` containing `docker-compose.yml` and `.env`.
- The bundle must declare `SUPABASE_PUBLIC_URL=http://127.0.0.1:55421`.

## Start

From the repository root in PowerShell:

```powershell
.\scripts\start-local-demo.ps1
```

The script checks Docker, starts only the `voicepilot-local-loopback` Compose project, provisions synthetic fixtures, starts the isolated Next.js server, and prints the local URL. It never prints keys or passwords.

To use an already-running approved loopback stack:

```powershell
.\scripts\start-local-demo.ps1 -SkipServices
```

Press Ctrl+C or stop the process to run fixture cleanup and stop only the demo-owned Compose project.

## Walkthrough

1. Sign in with a synthetic fixture account.
2. Review the tenant-scoped dashboard counts.
3. Open Agent Builder and inspect the assigned mock configuration.
4. Add or edit a text Knowledge Base source.
5. Create a contact and inspect consent/opt-out handling.
6. Create a draft campaign and assign the authorized non-archived agent.
7. Open campaign review and run readiness preflight.
8. Run the Offline Rehearsal using synthetic scenarios only.
9. Inspect Calls and Analytics. These are browser-tab synthetic outcomes, not real calls or persisted customer analytics.
10. Open Recovery to review simulated termination-safety states.
11. Use Settings for profile and organization configuration.

Persisted configuration is limited to the local disposable database. Synthetic rehearsal outcomes are temporary, redacted, and browser-tab scoped. No demo screen should be interpreted as evidence that a customer was contacted.

## Failure recovery

- Missing bundle: obtain the approved local Supabase bundle; do not fabricate `.env` or keys.
- Docker unavailable: start Docker Desktop and verify `docker info`.
- Health timeout: inspect only `docker compose --project-name voicepilot-local-loopback ps` and retry after the loopback services are healthy.
- Stale fixtures: run `.\scripts\local-supabase-fixtures.ps1 -Action cleanup`.

Do not use `docker system prune`, broad volume deletion, production Supabase URLs, or provider activation flags.
