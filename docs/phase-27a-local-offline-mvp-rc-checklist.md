# Phase 27A — Local offline MVP release-candidate checklist

Status: **NO-GO for RC sign-off; conditionally suitable for a controlled local demo**.

The application remains suitable in scope for an offline SaaS demonstration: authenticated tenant configuration, deterministic agent testing, synthetic knowledge retrieval, local Knowledge Base references, contacts/consent, campaign readiness/rehearsal, analytics, settings, governance and recovery are present. RC sign-off is blocked by authenticated browser-suite fixture isolation failures, not by authorization to activate live voice.

## Verified demonstration boundary

- Local app only; no production deployment.
- Synthetic loopback Supabase fixtures only; no customer data.
- Offline/mock provider paths only.
- No LiveKit rooms or tokens, microphone, STT, LLM, TTS, telephony, messaging, SQL or migrations.
- Campaign audience selection and rehearsal results remain session-local and synthetic.
- Knowledge retrieval demo remains fixed synthetic content; Knowledge Base records are references, not indexed/retrievable production knowledge.

## Authenticated browser evidence

The broad authenticated run exercised 28 tests with **25 passed and 3 failed**:

- Passed: login/session, dashboard navigation, mobile navigation, agent builder, Offline Agent Test Studio, synthetic retrieval, Knowledge Base CRUD/reference safety, CSV import, consent API authorization, campaign workspace/readiness portions, governance, analytics/settings navigation and recovery.
- One contacts test failure was a stale assertion for removed “preview mode”/“Import is disabled” copy. The test was updated to assert the current honest “provider-disabled workspace” and no-enrollment/no-outreach copy.
- Two campaign failures were fixture-isolation/order failures: the full journey left a synthetic contact visible to the following readiness test, changing the expected five-contact fixture to six; a separate fresh fallback run also encountered login/fixture instability. No new application defect was confirmed.

The campaign full-journey test had previously passed in a clean bounded fixture run during Phase 25B. It is not counted as fresh Phase 27A success because the current RC run did not achieve a clean, repeatable suite result.

## RC checklist

| Area | Status | Evidence/limitation |
| --- | --- | --- |
| Login and dashboard | PASS | Authenticated browser coverage passed in the broad run |
| Agent configuration and offline studio | PASS | Agent workflow and synthetic retrieval browser tests passed |
| Knowledge Base references | PASS | CRUD, unsafe URL rejection and metadata-only file reference tests passed |
| Contacts CSV/consent | PASS with test maintenance | Import and consent authorization passed; stale labeling assertion updated |
| Campaign configuration | PASS in broad run | Workspace and authorization tests passed |
| Audience readiness/rehearsal | BLOCKED for RC sign-off | Fixture contamination/order dependence prevented a clean combined result |
| Analytics and Settings | PASS | Dashboard navigation/governance tests passed |
| Simulation-only labeling | PASS | Browser assertions found simulation/no-provider/no-outreach labels |
| Tenant authorization | PASS in exercised paths | Cross-tenant campaign/contact/preflight checks passed |
| Production/live voice | NO-GO | Phase 26C independent approvals remain pending |

## Confirmed RC blockers

1. The approved Docker-backed isolated runner is unavailable in this environment (`docker` is not available on PATH). The manual REST fixture fallback can provision users but does not guarantee cleanup of test-created records after a timed-out browser test.
2. The campaign browser suite shares a fixture across files and is order-sensitive when a test times out before deleting its synthetic contact/campaign. This invalidates fixed fixture-count assertions.
3. A clean authenticated campaign-runner path must be restored or the suite must provision/tear down an isolated fixture per mutating spec before RC sign-off.

## Known limitations

- No durable campaign audience/run/event persistence; Phase 16 remains NO-GO.
- No production Knowledge Base ingestion, indexing, embeddings or retrieval.
- No real voice, external AI providers, worker leases, SIP, telephony, recording, billing or webhooks.
- Provider governance screens do not activate providers or provision secrets.
- Local analytics/calls/recovery are synthetic and browser/local-contract based.

## Release recommendation

**Controlled local demo: CONDITIONAL GO.** Use a fresh, verified fixture environment and demonstrate only the offline configuration/rehearsal scope.

**Offline MVP RC sign-off: NO-GO.** Close the fixture isolation blocker, rerun the complete authenticated journey with 0 failures, and record the clean result before calling this a release candidate.

Independent approval remains required for Phase 12F worker authority, Phase 16 campaign persistence, browser connectivity, providers, telephony and production deployment.
