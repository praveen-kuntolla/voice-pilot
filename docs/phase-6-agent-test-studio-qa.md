# Phase 6 Agent Test Studio QA

## Scope

The Agent Test Studio is a local, deterministic simulation. It supports a bounded multi-turn session, five synthetic scenario presets, server-verified agent preflight before every turn, interruption, reset, end, and reviewed local transcript previews. The UI is explicitly labelled **SIMULATION ONLY — NO AUDIO / NO LIVE PROVIDERS**.

## Safety properties

- No microphone, LiveKit, STT, LLM, TTS, telephony, messaging, or external provider request is made by the mock runtime.
- The browser sends no organization identifier as an authorization claim. Each turn calls the authenticated server preflight endpoint, which resolves the selected organization and agent ownership server-side.
- Sessions are held in React memory only. Reset, agent changes, unmount, and stale request generations clear the controller and suppress late responses.
- Input is bounded to 1,000 characters and a session is bounded to eight turns and 200 retained events.
- Failed sessions require reset; interrupted sessions return to idle; ended sessions cannot accept new turns.
- Export remains local-only and requires review. It contains no contact records or credentials, but redaction is best effort and user review is required.

## PR #20 review remediation — 2026-10-29

- **Preflight rejection is a revocation:** when server preflight is denied, malformed, unavailable, or changes the selected agent or current session's organization, the client terminates the old mock controller, invalidates the request generation, clears the previous timeline, preview, reviewed checkbox and stored authorization snapshot. It displays a generic authorization error; no transcript exports remain available. The locally typed sample draft is intentionally retained so the user can correct or reauthorize without losing unsent input. This also applies to a response with `allowed: true` but mismatched scope.
- **Revalidation is mandatory:** even after an authorized turn, the next turn temporarily drops export eligibility during preflight. Every subsequent turn must obtain a new successful server preflight. Once authorized, deterministic mock provider errors still retain reviewable synthetic diagnostic events and require Reset.
- **Turn-cap UX:** at exactly eight consumed turns the run and next-preset controls are disabled, the UI displays `Reset to start another simulated session.`, and the runtime retains its independent ninth-turn rejection.
- **Stale async:** request-generation and abort checks suppress results after reset, unmount, agent change or invalidation; the regression suite covers delayed denied responses.

### Regression coverage

- `tests/voice-runtime.test.ts`: fail-closed approval/scope validation, malformed organization UUID rejection, default eight-turn cap (in addition to multi-turn order/error/interruption).
- `tests/e2e/phase-6-agent-studio.spec.ts`: authorized first turn → intercepted 403 on second preflight → timeline, export and prior approval disappear; retry denied, then recover through a **fresh successful** preflight; reject mismatched agent and mismatched organization; cap at eight without a ninth preflight; reset while a denied preflight response is pending. Requires the established isolated local Supabase fixtures.
- Other authenticated E2E and tests are unchanged except when explicitly covered above.

### Current verification evidence — PR head `f63534a768f17d48983115e99dd2b641aea41361`

- GitHub offline CI was independently verified successful at the preceding review head: both the push workflow (`40825365503`) and PR workflow (`40825369496`) completed all six checks green. Recorded hosted totals were **250 Vitest passed / 20 skipped**, **51 Python passed**, **3 synthetic developer-preview Chromium passed**, with npm install, TypeScript, ESLint, production build, and `git diff --check` passing.
- Fresh user-controlled isolated authenticated Playwright at the current head passed **29 tests with 3 skipped**. It covered denial revocation, organization and agent mismatch rejection, the eight-turn cap, reset and unmount stale-response suppression, existing authenticated workflows, and no external provider requests. Disposable fixture cleanup succeeded; the temporary `.local` junction was removed and fixture metadata was absent afterward.
- Fresh focused runtime verification passed **13 Vitest tests**, TypeScript, ESLint, and `git diff --check`. The broader hosted CI remains the authoritative full-suite result; any checks triggered by the documentation-only follow-up commit should be recorded separately from these prior results.

### Independent hosted CI

- `.github/workflows/pr20-offline-quality.yml` runs on the feature branch and relevant PR updates with read-only GitHub permissions, nonfunctional loopback Supabase placeholders and all worker/provider/outbound activation flags disabled.
- Separate Windows jobs run npm ci, TypeScript, ESLint, Vitest, production build, `git diff --check`; isolated **developer preview only** Chromium tests; and Python pytest against the installed worker package without starting a worker or connecting to a provider.
- Authenticated Supabase Playwright is **not run on GitHub-hosted CI**. Its completion must be reported from a user-controlled isolated test worktree, with successful fixture cleanup and `Test-Path ".\\.local\\voicepilot-local-loopback-fixtures.json"` equal to `False` after the run.
- Previous Codex-reported `248 passed / 20 skipped` Vitest, `51 passed` Python, and `23 passed / 3 skipped` isolated Playwright apply to the **original Phase 6 commit** `14b51b105068a36076a096e694b5f74ea2fdbd68` only. **Do not treat them as acceptance for the review-fix commits.** Hosted CI and fresh local E2E results must be recorded separately.

**Safety:** no real provider requests, database writes/migrations, LiveKit, microphone, outbound calls, messaging, deployments, credential changes or Docker volume cleanup. Established migrations **001–011** remain untouched; **012–016 are review-only** on established or remote databases. Keep this PR **draft and unmerged** until review.

## Verification checklist

| Check | Result |
| --- | --- |
| Runtime schema and tenant scoping | Focused Vitest |
| Ordered multi-turn event timeline | Focused Vitest |
| Preset validation and deterministic modes | Focused Vitest |
| Duplicate active turn rejection | Focused Vitest |
| Input and event bounds | Focused Vitest |
| Interrupt, end, failure and reset lifecycle | Focused Vitest / authenticated E2E when fixtures are available |
| Agent ownership and organization authorization | Existing server preflight plus authenticated E2E when fixtures are available |
| No external provider requests | Authenticated E2E request assertion when fixtures are available |
| Export preview | Existing and Phase 6 authenticated E2E when fixtures are available |

Authenticated browser tests require the approved isolated local Supabase fixtures and `E2E_ISOLATED_AUTH=true`. They must not use production credentials or records. If fixtures are unavailable, the authenticated checks remain skipped rather than being represented as passed.

## Limitations and follow-up

The runtime is intentionally mock-only. It does not prove provider connectivity, audio quality, real-time latency, billing behavior, consent enforcement for real calls, or production tenant isolation. A future provider test requires a separately approved isolated environment, server-only credentials, distributed replay/rate limiting, and an explicit emergency-stop procedure. No migration or provider activation is part of Phase 6.
