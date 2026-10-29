# PR #17 developer preview QA

Tested locally on `http://127.0.0.1:3003/developer-preview` with synthetic in-memory data only. The authenticated checks used the isolated local Supabase fixtures through the existing runner on port 3001; no remote services or provider integrations were used.

## Control matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Overview, simulation-only label, quick navigation | PASS | Playwright developer-preview navigation test |
| Agent validation, add, edit, status toggle | PASS | Focused browser control test |
| Contact validation, add, search, consent filter, revoke | PASS | Focused browser control test |
| Campaign validation, create, start, pause, resume, stop, reset | PASS | Focused browser control test |
| Calls simulation and emergency-stop rejection | PASS | Navigation/synthetic operations test |
| Analytics synthetic metrics and JSON download | PASS | Focused browser control test; authenticated report-download test |
| Settings theme and synthetic reset | PASS | Focused browser control test |
| Real login link | PASS | Link resolves to `/login`; authenticated login is tested separately |
| Backend persistence from developer preview | NOT IMPLEMENTED | Deliberately isolated; no backend writes |
| Real calls, microphone, LiveKit, STT, LLM, TTS, telephony | NOT IMPLEMENTED | Deliberately disabled |

## Results

- Developer-preview Playwright: **3 passed**.
- Isolated authenticated Playwright: **19 passed, 3 skipped**. The three skipped tests are the development-only preview tests when the production runner is used.
- TypeScript, ESLint and production build: **passed**.
- Browser page errors and failed requests observed during the focused control run: **none**.
- Fixture cleanup: **passed** through the existing isolated runner.

The export implementation now keeps its object URL alive briefly after the click so browsers can complete the download before cleanup. The existing preview remains synthetic and session-local.

## Latest navigation correction — verified locally

After the above recorded test run, PR #17 also corrected the **real authenticated dashboard** sidebar:
- `Settings` now resolves to the implemented `/settings` page, not missing `/dashboard/settings`.
- `Call simulation` and `Simulation reports` navigate to the existing `/dashboard/campaigns#simulation-studio` rather than missing `/dashboard/calls` and `/dashboard/analytics`.
- The `/settings` route now requires authentication in the Next.js session proxy.
- New `tests/e2e/dashboard-navigation.spec.ts` verifies guest redirect, authenticated link destinations, Settings navigation, and simulation-studio navigation.

Fresh isolated Playwright execution verified the guest redirect and authenticated Settings/simulation navigation: **2 passed**. The full isolated run completed with **19 passed, 3 skipped** and fixture cleanup passed.

## Coverage limitations

This acceptance tests representative controls and paths, **not every possible backend API state or every dashboard button**. Dedicated real Calls and Analytics pages are not implemented. The developer preview is synthetic in-memory state; it does not persist to Supabase or perform real calls. Real calling, messaging, AI provider integration, billing, production release, and migrations 012–016 remain out of scope.
