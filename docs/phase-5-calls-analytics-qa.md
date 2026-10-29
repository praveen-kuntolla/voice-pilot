# VoicePilot Phase 5 — authenticated Calls and Analytics QA

Status: **feature branch only; this authoring session has not run local Windows tests**.

## Dependencies and safety

- Branch: `feature/authenticated-calls-analytics`, created from PR #17 head `1e076908ce898b2890acbd9b4737be48e89ce556`.
- Open a **stacked draft PR targeting `feature/local-developer-preview-qa`** so the diff excludes PR #17. After PRs #16 and #17 are independently reviewed/merged, rebase/synchronize and rerun before retargeting `master`.
- The established local database migration ledger stays **001–011**. Migrations **012–016 are review-only and must not run on established or remote databases**.
- No provider connectivity or real calls, texts, STT, TTS, LLM, LiveKit, remote Supabase, billing, deployment, or external telemetry.

## Implemented screens

### `/dashboard/calls`

- Server checks Supabase user and current organization membership. Guests redirect to login; users without membership redirect to onboarding.
- Shows current tab's redacted, **simulated terminal outcomes**: timestamp, terminal state, outcome category.
- Date and outcome filters, outcome detail, JSON download (no contact IDs, phone numbers, emails, transcripts), tab-data clear action, and honest empty states.
- No real call history or outbound call controls.

### `/dashboard/analytics`

- Same authentication and organization scoping.
- Summary cards, outcome-distribution bar charts, and a mock scenario funnel, all computed from the same redacted tab-only records.
- No synthetic data is invented as customer activity; no revenue or conversion figures are claimed.

### Activity source and lifecycle

- Only `MockCampaignSimulation` terminal states from the existing simulation studio are copied.
- Browser `sessionStorage`, key scoped to the server-verified organization UUID, stores **only a random synthetic record ID, timestamp, terminal state, and outcome enum**.
- No direct persistence into Supabase, calls, campaigns, CRM, server logs, or real provider systems.
- Hard limit **200** most recent redacted outcomes, discard records older than **30 days**. Browser-tab storage may be lost when the tab/window closes.
- A successful sign-out clears all organization-scoped synthetic tab summaries; explicit Clear removes the selected organization only.
- Reuse of the existing `/dashboard/campaigns#simulation-studio` to generate a mock outcome is required before charts and rows populate.

## Regression tests

- Unit tests: `tests/simulation-activity.test.ts` — organization separation, malformed storage rejection, retention, 200-row cap, date/outcome filtering, metrics, export redaction.
- New isolated Playwright: `tests/e2e/authenticated-simulation-activity.spec.ts` — real isolated login, empty state, simulation -> Calls -> Analytics, filtering, download, and clear.
- Updated `tests/e2e/dashboard-navigation.spec.ts` — protected Calls/Analytics routes plus implemented sidebar paths.

## Local Windows acceptance

Use an **independent safe worktree** if changing branches would disturb uncommitted `tsconfig.tsbuildinfo`, `next-env.d.ts`, or cache files. Verify the Next.js local server belongs to this checkout and the isolated Docker Compose project uses loopback ports before testing.

From this branch in PowerShell:

```powershell
npm run typecheck
npm run lint
npm test -- tests/simulation-activity.test.ts
npm run build
powershell -ExecutionPolicy Bypass -File .\scripts\run-isolated-e2e.ps1 -TestSelection all -Runtime production -ServerPort 3004
```

Pick an available loopback port; **never kill a pre-existing listener without ownership verification**. The established E2E runner enforces local Compose identity, migration ledger 001–011, fixture cleanup, and process ownership. Don't paste fixture credentials into logs or commit them.

Record PASS/FAIL/SKIPPED/NOT IMPLEMENTED by route and button, screenshot evidence, browser console/network errors, test counts, and isolated fixture cleanup. The new routes cannot be marked QA-passed solely from code review.

## Explicit limitations

- **These are synthetic outcome summaries, not a call database.** They are not durable across browsers, devices, sign-outs, or cleared tab storage.
- No call audio, dialer, recording, transcript, contact lookup, actual agent response, duration, billing, cost, or real conversion analytics is available.
- The developer preview remains a separate simulation-only page; it does not grant authentication.
- No automatic merge or deployment.
