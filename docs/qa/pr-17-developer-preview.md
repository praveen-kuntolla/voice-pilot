# PR #17 developer preview QA

Tested locally on `http://127.0.0.1:3002/developer-preview` with synthetic in-memory data only. The authenticated checks used the isolated local Supabase fixtures through the existing runner on port 3003; no remote services or provider integrations were used.

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
- Isolated authenticated Playwright: **17 passed, 3 skipped**. The three skipped tests are the development-only preview tests when the production runner is used.
- TypeScript, ESLint and production build: **passed**.
- Browser page errors and failed requests observed during the focused control run: **none**.
- Fixture cleanup: **passed** through the existing isolated runner.

The export implementation now keeps its object URL alive briefly after the click so browsers can complete the download before cleanup. The existing preview remains synthetic and session-local.
