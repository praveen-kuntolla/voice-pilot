# VoicePilot Phase 5 — authenticated Calls and Analytics QA

Status: **integrated with merged `master`; local authenticated browser acceptance and independent Windows GitHub CI passed on 2026-10-29. Formal review and merge authorization remain pending.**

## Integration and safety

- Branch: `feature/authenticated-calls-analytics`, targeting `master`.
- PR #16 and PR #17 have merged into `master`. PR #18 was synchronized through commit `1fb93d78a6fb16ccc009ab91ad8b9670e22487cc`; latest application and offline-quality test commit before this documentation update: `7296d243d7680ef8faf8b0ea9102b4969814aece`.
- The full integration tree preserves the original Phase 5 feature changes and the operational-safety changes introduced by PR #16. The PR was zero commits behind `master` at acceptance.
- Established local database ledger stays **001–011**. Migrations **012–016 remain review-only** and must not run on established or remote databases.
- **Never enable** real calls, provider connections, STT, TTS, LLM, LiveKit, messaging, billing, remote Supabase, deployment, or external telemetry as part of these acceptance tests.

## Implemented screens

### `/dashboard/calls`

- Supabase server verifies the user and selected-organization membership. Guests redirect to login; users without valid membership are redirected to onboarding.
- Shows redacted **simulated terminal outcomes** from the current browser tab: timestamp, terminal state, and outcome category.
- Outcome/date filters, synthetic outcome details, redacted JSON export and explicit tab-data clear.
- Does not expose a real dialer or real call history.

### `/dashboard/analytics`

- Uses the same authenticated and organization-scoped server authorization.
- Renders mock KPI cards, outcome distribution, and scenario funnel based on the same synthetic tab records, never fabricated customer activity.
- Does not claim real revenue, conversions, duration, or call costs.

### Data boundary

- Source: terminal events from `MockCampaignSimulation` after a new authoritative simulation preflight.
- Browser `sessionStorage`, key scoped by server-verified organization UUID. Only synthetic random record ID, timestamp, terminal state and mock outcome category are kept.
- Most recent **200** records per organization, with **30-day** record validation. Data is lost when storage is cleared or the tab context ends; this is not persistent analytics.
- Successful dashboard sign-out clears the synthetic summaries; the Clear button removes the currently selected organization's local summary.
- No contact or lead IDs/names, phone numbers, email addresses, transcripts, recordings, provider payloads, campaign or agent identifiers are included in the dedicated Calls/Analytics tab reports.
- To populate these views, use `/dashboard/campaigns#simulation-studio` with approved synthetic fixtures. No provider requests or calls are initiated.

## Local Windows validation — 2026-10-29

The user supplied PowerShell evidence from a clean detached worktree `voicepilot-ai-pr18-integrated`, at application commit `7296d243d7680ef8faf8b0ea9102b4969814aece`:

| Check | Verified outcome |
| --- | --- |
| `npm ci` | PASS, 0 reported vulnerabilities |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **244 passed, 20 skipped** |
| `npm run build` | PASS with process-scoped nonfunctional loopback Supabase placeholders; the two dedicated routes are explicitly dynamic |
| Isolated authenticated `Playwright` production run | **20 passed, 3 skipped** |
| Browser installation | Matching Playwright Chromium / headless shell installed locally |

The existing `voicepilot-local-loopback` Docker Compose services were healthy, with API `127.0.0.1:55421`, pooler `127.0.0.1:55422` and studio `127.0.0.1:55423`.
The worktree used a local junction to access ignored Supabase configuration under the original checkout's `.local/supabase-loopback-source`, **without copying secrets into Git**.
The fixture metadata file was absent **before** the successful final run. The runner returned without reporting any cleanup failure; a separate **post-run** `Test-Path` confirmation has not yet been provided.

The isolated production-mode runner intentionally skips three developer-preview-only tests. Those tests were executed separately by hosted CI, below.

### Local authenticated test procedure

From a dedicated verified test worktree with the already running isolated Compose project and valid local configuration:

```powershell
npm run typecheck
npm run lint
npm test
powershell -ExecutionPolicy Bypass -File .\scripts\run-isolated-e2e.ps1 -TestSelection all -Runtime production -ServerPort 3004
Test-Path ".\.local\voicepilot-local-loopback-fixtures.json"
```

Expected final metadata path check: `False`. **Never delete metadata manually or reset volumes** if cleanup has a problem; inspect the generated fixture IDs and isolate ownership first. Do not print or commit fixture passwords. Use an available verified loopback server port; do not kill unrelated listeners.

To compile without real Supabase credentials, set `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55421` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to a clearly nonfunctional temporary placeholder in the process environment, then clear them. That test build does not exercise authentication.

## GitHub-hosted Windows CI — 2026-10-29

- Run: https://github.com/praveen-kuntolla/voice-pilot/actions/runs/40820345861
- Head: `7296d243d7680ef8faf8b0ea9102b4969814aece`.
- **Both jobs completed successfully**: npm ci, TypeScript, ESLint, **244 passed / 20 skipped** Vitest, production build, git diff check, plus **3 passed** Chromium developer-preview Playwright.
- Read-only repository permission; nonfunctional loopback Supabase placeholders; Node 24 and Windows runner; no real provider credentials or remote database services.
- Hosted CI does **not** replace the local authenticated browser suite because that suite requires an existing isolated Docker/Supabase project and carefully scoped fixtures.

## Test coverage and limitations

- `tests/simulation-activity.test.ts`: organization-scoped keys, invalid record rejection, 200-row cap, retention, filters, metrics and export redaction.
- `tests/e2e/authenticated-simulation-activity.spec.ts`: isolated login, empty state, simulation to Calls and Analytics, filtering, export and clear.
- `tests/e2e/dashboard-navigation.spec.ts`: guest redirects, implemented authenticated links and navigation.
- QA does not establish production readiness, complete accessibility/performance compliance, real call correctness, or durable analytics.

## Remaining release gates

1. Obtain independent human code review / approval. The assistant's technical inspection is **not** a formal GitHub review approval.
2. Verify the fixture metadata path is absent **after** the last local Playwright run.
3. Request separate explicit authorization before merging PR #18. **No automatic merge or deployment.**
4. Production migrations, telephony/provider configuration, live calls, messaging, billing and remote Supabase remain excluded.
