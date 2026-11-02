# Phase 28A — Local Offline MVP Demonstration Handoff

## Demonstration status

**GO for a controlled local offline demonstration only.** The verified baseline uses synthetic loopback Supabase fixtures, deterministic simulations, and provider-disabled application paths. It is not a production deployment and does not place calls.

Working demo URL: `http://127.0.0.1:3402`

The active demo was verified with HTTP 200 from `/api/health` and a browser login reaching `/dashboard`.

## Safety boundary

- Supabase must be the approved loopback endpoint `http://127.0.0.1:55421`.
- Fixtures are synthetic and tenant-scoped; no customer data is used.
- Realtime, outbound, worker, LiveKit, microphone, STT, LLM, TTS, telephony and provider activation remain disabled.
- Knowledge Base records are stored source references only. The separate retrieval panel uses fixed synthetic content.
- Campaign audience selection and rehearsal results are session-local and are not durable campaign runs.
- Calls, analytics, recovery and governance demonstrations are synthetic or local-only.

## Start and stop

From the repository root in PowerShell:

```powershell
.\scripts\start-local-demo.ps1 -Port 3410
```

Use `-Port 3402` only when that port is not already occupied by the existing demo. The launcher verifies the approved loopback bundle, starts only the `voicepilot-local-loopback` Compose project, provisions synthetic fixtures, starts the isolated Next.js server, and does not print secrets.

If the approved loopback services are already running:

```powershell
.\scripts\start-local-demo.ps1 -SkipServices -Port 3410
```

Stop with `Ctrl+C` in the launcher window. It cleans the launcher-owned fixtures and stops only the launcher-owned Compose project. Do not use `docker system prune` or broad volume deletion. Preserve the existing 3402 process unless you intentionally own it.

Docker Desktop with the Linux engine, Node.js, dependencies, and the approved `.local\supabase-loopback-source` bundle are required for a new demo process. The current environment’s 3402 demo is already active.

## Synthetic login

Use a fixture account created by the launcher. The account email may be inspected privately without printing the password:

```powershell
$fixture = Get-Content .local\voicepilot-local-loopback-fixtures.json -Raw | ConvertFrom-Json
$fixture.users[0].email
```

Enter the password privately in the browser. Never paste it into the terminal, documentation, screenshots or logs. The Phase 28A verification used the first synthetic fixture account and reached the dashboard successfully.

## Guided walkthrough

1. Dashboard — confirm the workspace and tenant-scoped counts.
2. Agent Builder — inspect the configured synthetic agent and its mock voice/profile. Use “Test safely”.
3. Offline Agent Test Studio — select the agent, run a deterministic text-only scenario, and observe the explicit simulation/no-audio/no-provider labels.
4. Synthetic knowledge retrieval — use the fixed synthetic catalog and keyword matching panel. This does not read customer Knowledge Base records.
5. Knowledge Base — add or edit a text, URL reference, or file reference. Explain that URL/file entries are stored references only; there is no fetch, upload, extraction, indexing or agent assignment.
6. Contacts — import a small synthetic CSV or create a contact. Confirm imported consent defaults to `unknown`.
7. Consent — edit the contact to granted or revoked and show that consent affects hypothetical readiness. No outreach occurs.
8. Campaign workspace — create and save a draft with an authorized non-archived agent. Point out the saved configuration versus session-local rehearsal boundary.
9. Audience readiness — select contacts in the review screen and run the authorization/preflight check. Consent is revalidated; selections are not persisted.
10. Offline rehearsal — run the bounded synthetic activity, then stop/reset it. There is no live dispatch and no durable campaign run.
11. Analytics and Calls — show synthetic/local-only activity labels; do not present them as customer call history.
12. Settings, Governance and Recovery — review organization/profile settings, provider-disabled governance, and simulated recovery states.

## Verified browser baseline

The authenticated Chromium suite runs against an isolated production build with one owned server and fresh synthetic fixtures:

```powershell
$env:AUTHENTICATED_E2E_SERVER_MODE = 'production'
$env:NEXT_DIST_DIR = '.next-phase28a-build'
node scripts/test-authenticated-browser-windows.mjs
```

The production build must be created with the approved loopback `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; do not use placeholders for an authenticated run. The runner provisions and cleans its own fixtures and never enables providers in production mode.

Phase 27C evidence: the previously failing scenarios passed 15/15; the complete 28-scenario suite passed 28/28 twice, with zero unexpected skips. Campaign/contact cleanup returned successful deletion responses and consent mutations were restored.

## Known limitations and blockers

- Phase 12F trusted worker authority remains approval-gated.
- Phase 16 durable campaign audiences, runs and events remain NO-GO.
- Production Knowledge Base ingestion, extraction, chunking, embeddings and retrieval are not implemented.
- No external AI providers, LiveKit rooms, browser microphone, SIP, telephony, recording, billing or webhooks are enabled.
- Analytics, Calls and Recovery views are synthetic/local demonstrations.
- Production deployment, customer data and real outreach require independent security, provider, compliance and operational approvals.

## Verification performed for this handoff

- Read `AGENTS.md`, the Phase 27A checklist and existing local demo/runner documentation.
- Confirmed the launcher and isolated server enforce loopback Supabase configuration and disabled voice/provider flags.
- Browser login verification on `http://127.0.0.1:3402`: passed without printing credentials.
- Port 3402 `/api/health`: HTTP 200.
- Phase 27C regression evidence: TypeScript, ESLint, Vitest, Python worker tests, isolated production build and `git diff --check` passed.
