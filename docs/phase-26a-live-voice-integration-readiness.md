# Phase 26A — Real AI voice integration readiness

Status: **review-only readiness assessment**. This document does not authorize provider activation, LiveKit rooms, microphone access, STT/LLM/TTS requests, telephony, SQL, migrations, Phase 12F implementation, or Phase 16 implementation.

## Executive decision

OUTLIVO has a credible offline configuration and simulation foundation, plus guarded contracts for a future browser-to-LiveKit session. The shortest safe path is to prove one bounded, browser-only, provider-neutral connectivity session in an independently approved disposable environment, then add provider adapters one at a time behind the existing server-side gates. Outbound calling is a later capability and cannot be inferred from browser voice readiness.

Current decision: **NO-GO for real AI voice or telephony activation.**

The first safe implementation milestone is a review-approved contract test and isolated browser-connectivity harness that keeps `VOICE_PROVIDER_MODE=mock`, `VOICE_OUTBOUND_ENABLED=false`, publishes no browser audio, uses no customer data, and verifies admission, tenant binding, replay protection, timeout, disconnect cleanup and emergency denial. It must not be run until the Phase 12F/voice-platform owners approve that exact disposable test.

## Dependency diagram

```text
Authenticated dashboard
        |
        | server-side org + agent + microphone-consent checks
        v
Browser-session admission API  --disabled by default--> short-lived LiveKit JWT
        |                                             |
        | durable admission / replay / rate limits    v
        |                                      Isolated LiveKit project
        v                                             |
Phase 12F worker lease + signed config  <--------------+
        |
        | future, separately approved provider adapters
        v
       STT  -->  tenant-bound conversation  -->  LLM  -->  TTS
        |                                               |
        +--> redacted lifecycle + usage + stop/release-+

Later, separate authority:
consent + campaign admission --> approved telephony/SIP provider --> call evidence
```

The current offline path stops before microphone media, external providers, worker leases, telephony and durable campaign runs. Phase 16 remains NO-GO and cannot be used as the campaign dispatcher for this roadmap.

## Existing capability inventory

| Capability | Classification | Evidence and boundary |
| --- | --- | --- |
| LiveKit room naming and server token route | Implemented but disabled/unavailable by default | `POST /api/livekit/token` authenticates the user, checks membership and same-tenant agent ownership, creates a short-lived room/token and registers room authorization. It fails closed when LiveKit configuration is absent. No room was created in this phase. |
| Browser voice-session admission route | Implemented but disabled | `POST /api/livekit/browser-session` requires explicit microphone consent, feature flags, durable-admission wiring and same-tenant agent ownership. Flags and durable wiring are disabled by default. |
| Browser LiveKit session state machine | Implemented contract, unactivated | `LiveKitBrowserVoiceSession` models connect, reconnect, microphone enable/disable, disconnect and cleanup, but no browser microphone or LiveKit session was used here. JWT revocation is not provider-side room removal. |
| Browser audio capture | Missing from approved runtime | The UI and contracts prepare for microphone consent; the offline studio accepts typed synthetic speech and creates no media. A production media-permission UX and active-room cleanup policy remain unapproved. |
| STT | Mock/simulation-only | Python and TypeScript contracts define streaming chunks; `MockSTT` is deterministic. Deepgram is a validation-only identifier; no SDK, credential or request is active. |
| LLM | Mock/simulation-only | `MockLLM` is deterministic and tool calls are diagnostic-only. OpenAI is a validation-only identifier; no provider request is active. |
| TTS | Mock/simulation-only | `MockTTS` returns deterministic bytes that are not playable media. ElevenLabs is a validation-only identifier; no provider request is active. |
| Voice profile configuration | Implemented for local validation | Language/voice identifiers and mock compatibility are bounded. Real voice capability, locale, consent and provider-specific voice review are missing. |
| Python worker | Implemented but disabled / contract-only for real mode | Worker identity parsing, signed config admission, participant binding, lifecycle cleanup and provider-bundle seams exist. Real mode fails because real adapters are not implemented and the worker/realtime flags are off. |
| Worker authorization | Implemented offline; awaiting Phase 12F approval for durable authority | HMAC timestamp/nonce verification, tenant/room checks and local security-store contracts exist. Review-only lease SQL has unresolved approval findings and has not been applied. |
| Call lifecycle and event validation | Mock/simulation-only | `OfflineCallLifecycle` validates tenant binding, transitions, replay fingerprints, bounded events, usage fields and emergency-stop callbacks. It persists nothing and is not carrier evidence. |
| SIP/telephony configuration | Implemented validation only, disabled | `src/lib/telephony.ts` supports `mock`, `twilio` and `telnyx` identifiers but rejects activation outside disabled/safe simulation contracts. No SIP trunk, phone number, webhook or provider account is active. |
| Outbound calling | Missing / blocked | No approved dialer, queue, carrier authorization, call-attempt authority, termination evidence or campaign-run authority exists. Phase 16 remains NO-GO. |
| Consent and opt-out | Implemented for offline readiness | Server preflight rechecks tenant, agent, campaign and contact consent; simulations block ineligible contacts. Real calls require transactional admission, revocation handling, calling-hours rules and carrier-side stop behavior. |
| Recording and retention | Missing for real media | No recording is created in offline mode. Recording consent, region, encryption, retention, legal hold, deletion and transcript/audio access controls need separate approval. |
| Usage accounting | Implemented in local safety contracts | Provider reservation, usage, budget and emergency-stop abstractions are present in test/local safety modules. Durable production accounting, billing reconciliation and provider meter mapping remain unverified. |
| Emergency stop | Implemented offline / contract-only for real authority | Local lifecycle and safety controls can deny synthetic work. A production stop must block new admission, signal workers, terminate provider sessions, reconcile leases and produce evidence. |

## Existing integration boundaries

Protected operations use server-side Supabase clients. The worker configuration endpoint is disabled unless the worker flag is enabled, requires a signed request, checks nonce/rate protection, binds room/tenant/agent identities and consumes single-use room authorization. The worker also validates the participant identity before building a session plan.

The important limitations are explicit:

- Application session revocation does not invalidate an already-issued self-contained LiveKit JWT or remove an active participant.
- The current local security store is a test aid; production requires a TLS-protected, ACL-controlled, highly available store and fail-closed behavior.
- Phase 12F worker leases, termination evidence, reconciliation and database grants are review-only. The handoff still has high findings around authorization state, evidence-producer identity and reconciliation authorization.
- Provider identifiers are schemas/contracts, not integrations. No provider SDK or external AI request is active.
- Offline calls, analytics, callbacks and appointments are synthetic browser-local results; they are not carrier, billing or customer records.

## Recommended staged architecture

### Stage A — Browser-to-agent voice contract, disposable only

Scope: one synthetic authenticated user and one synthetic agent in a dedicated loopback/test project. Keep provider mode mock, outbound disabled, no recording, no SIP and no customer contact data. Validate server-issued room/token binding, explicit microphone consent UX without enabling the microphone in this phase, signed worker admission, replay/rate limits, participant identity, bounded session duration, disconnect cleanup and emergency denial.

Required secrets/accounts: isolated LiveKit test project credentials, worker signing key and loopback security-store credentials in a secret manager or protected test environment. Never place API secrets in browser bundles, fixtures, logs or database rows.

Security gates: named voice-platform and database/security reviewers; approved disposable environment; Phase 12F contract findings closed or explicitly scoped out; one-session concurrency and duration limits; no-recording policy; cleanup proof.

Cost controls: one concurrent session, hard session timeout, provider mode mock, no outbound traffic beyond approved test endpoints, and a fixed test budget of zero external AI/telephony spend.

Acceptance tests: tenant/agent substitution, forged room, replayed nonce, stale signature, duplicate consumption, wrong participant, origin failure, expiry, disconnect, cancellation, emergency stop and cleanup after process failure. Capture sanitized evidence and confirm no provider, phone, recording or billing side effects.

Rollback: disable the browser-session flag, revoke test credentials, terminate only test rooms, clear test reservations and retain the evidence. Do not alter the active port-3402 demo or unrelated services.

### Stage B — Provider-backed STT, LLM and TTS for one browser session

Scope: add separate server/worker adapters behind the existing provider-neutral interfaces. Select one provider per modality only after capability, privacy, region, retention and contract review. No telephony and no campaign dispatch.

Required secrets/accounts: provider-specific server/worker identities, managed secret references, separate development/staging namespaces, key IDs, rotation and revocation procedures. The browser receives only session-scoped public authorization, never provider credentials.

Security gates: provider data-processing and retention review; prompt/transcript/audio redaction policy; model/voice allowlist; tool execution policy; egress allowlist; per-tenant quotas and budget reservation; timeout/cancellation behavior; provider webhook/signature review if applicable.

Cost controls: per-session token/audio ceilings, concurrency caps, max turns, budget reservation before admission, usage recording with idempotency, alerts and automatic denial on unavailable accounting.

Acceptance tests: provider timeout, partial/final STT ordering, LLM truncation, TTS cancellation, malformed provider response, retry/replay, data redaction, cost-limit denial, tenant isolation and no fallback from rejected real mode to mock.

Rollback: set provider activation false, revoke provider keys, deny new sessions, preserve redacted audit evidence and reconcile any open reservations. No automatic provider fallback.

### Stage C — Secure worker execution

Scope: activate a dedicated worker deployment only after Phase 12F approval. PostgreSQL becomes the sole authority for admission, worker lease, release, reconciliation and termination evidence; no dual memory/database authority.

Required identities: non-login database owner, least-privilege worker gateway role, separate reconciliation operator, authenticated termination-evidence producer, managed worker key with overlap rotation and revocation.

Security gates: execute the corrected review-only SQL only in an approved randomized disposable database first; prove role grants, RLS, atomic lease consumption, release, stale/expired denial, replay protection, audit immutability and failure recovery. Production cutover and rollback require written owner sign-off.

Cost controls: worker concurrency leases, tenant/provider quotas, global stop, per-session expiry, no unbounded retries and usage reservation before provider work.

Acceptance tests: all Phase 12F matrix tests, including concurrent lease creation, cancelled/expired binding denial, worker/provider evidence identity, wrong-role reconciliation denial, release failure, process crash and cleanup.

Rollback: stop new leases, preserve active lease state, reconcile with the approved operator, revoke worker keys and disable the worker flag. Do not delete evidence outside the approved retention process.

### Stage D — Approved telephony/SIP integration

Scope: provider-specific sandbox only, still outside campaign dispatch. Add inbound/outbound authorization, signed webhooks, call state mapping, carrier termination evidence, number ownership and regional compliance.

Required accounts: carrier sandbox, dedicated numbers, webhook endpoint identity, egress controls and provider secret references. No customer numbers during acceptance.

Gates: telephony/legal/compliance, consent and opt-out, calling-hours, recording, regional data processing, webhook replay, emergency termination and billing reconciliation approval.

Acceptance tests: synthetic number calls only, signature/replay checks, answer/hangup/timeout/failure mapping, provider-side termination, duplicate webhook handling, spend ceilings and emergency stop.

Rollback: disable dial admission, revoke carrier credentials, remove test numbers and verify no queued calls remain.

### Stage E — Consent-aware outbound calls

Scope: only after durable campaign audience/run approval (Phase 16) and telephony approval. Use a separate durable call-attempt authority that rechecks consent immediately before admission and invalidates work on revocation.

Required controls: approved persistent audience/run schema, immutable audience revision, idempotent call attempts, calling-hours/time-zone enforcement, opt-out propagation, per-tenant quotas, emergency stop and immutable redacted audit.

Acceptance tests: concurrent revocation, stale audience revision, duplicate attempt, cancellation, pause/resume, provider termination evidence, cross-tenant isolation, retention/deletion and recovery.

Rollback: block new attempts, cancel queued work, stop workers/providers, reconcile every active attempt and preserve audit evidence.

### Stage F — Production monitoring and billing

Scope: operational readiness, not a substitute for security approval.

Required controls: SLOs, alerts, secret rotation, key compromise response, cost dashboards, provider meter reconciliation, tenant-visible usage, incident runbooks, backups, deletion/retention jobs and support access reviews.

Acceptance tests: alert delivery, budget exhaustion, provider outage, worker crash, reconciliation, restore, deletion, legal hold and incident tabletop.

## Security review checklist

1. **Credentials:** managed secret references only; server/worker access; no browser exposure; key IDs, overlap rotation, revocation and audit.
2. **Browser tokens:** short TTL, exact tenant/agent/session room, no client-selected authorization, no SIP/publish permissions unless explicitly approved, origin checks, no-store responses and provider-side termination policy.
3. **Tenant isolation:** derive organization from authenticated membership; bind agent, campaign, contact, room, worker lease and provider action; reject forged IDs and mixed parents.
4. **Session authorization:** signed request with timestamp/nonce, atomic single use, replay/rate limits, expiry, participant identity, cancellation and durable release.
5. **Provider data:** explicit data-processing, region, retention, redaction, egress and model/voice allowlist; no raw secrets or unnecessary contact data in prompts/logs.
6. **Rates and spend:** admission reservation before work, per-session/tenant/global caps, max duration/turns, retry bounds, alerts and fail-closed accounting.
7. **Abuse prevention:** role checks, CSRF/origin checks, authenticated APIs, no arbitrary room/provider selection, audit trails, anomaly limits and operator stop.
8. **Recording consent:** separate explicit consent, jurisdiction policy, encryption, access audit, retention/legal hold/deletion, and default no recording.
9. **Emergency stop:** global and tenant stop blocks new work, signals workers, terminates provider sessions, prevents release spoofing and reconciles state.
10. **Worker lease security:** Phase 12F sole authority, least privilege, trusted evidence producer, immutable audit and independent reconciliation role.

## Required approvals and explicit gates

| Gate | Owner(s) | Required evidence | Status |
| --- | --- | --- | --- |
| Voice/browser sandbox | Voice platform, platform security, SRE | Disposable environment, one-session limits, no-recording/no-customer-data proof, cleanup log | Not approved |
| Phase 12F worker authority | Database/security, platform security, architecture, SRE | Corrected SQL, grants/ownership, concurrency and failure evidence, termination-evidence producer | Blocked; review-only |
| Provider STT/LLM/TTS | Provider owner, privacy/legal, security, finance | Provider contracts, secret references, data/retention/region review, quotas and cost tests | Not reviewed for activation |
| Telephony/SIP | Telephony owner, compliance/legal, security | Sandbox account, number/calling policy, signed webhooks, termination and billing evidence | Not approved |
| Durable campaign dispatch | Database/security, architecture, product | Phase 16 approval package closed and persistence acceptance complete | NO-GO |
| Production release | Release/SRE/security/product | Observability, rollback, incident and support evidence | Not reviewed |

## First safe implementation milestone

Prepare a review-only test package for **one disposable browser-connectivity session**:

1. Map the existing browser admission, worker signature, room authorization, lifecycle and cleanup contracts into one acceptance matrix.
2. Close or explicitly defer the Phase 12F findings that are prerequisites even for the sandbox.
3. Obtain named approval for the isolated LiveKit test project, synthetic identity, no-recording policy, one-session limit, short timeout, zero outbound/provider spend and cleanup owner.
4. Add only deterministic contract tests and test-runner diagnostics; keep all activation flags false by default.
5. Run the test only after approval, then capture sanitized evidence and revoke the test credentials.

This milestone does not add real providers, microphone capture, telephony, campaign persistence, migrations or production deployment. It is the shortest safe step because it validates the security boundary before introducing external data processing or customer contact.

## Exact review checks performed

- Read `AGENTS.md`.
- Inspected LiveKit token, browser-session, termination and worker-config routes; browser session, room authorization, voice profile, telephony, lifecycle, worker-auth, runtime and provider contracts; Python worker configuration, worker lifecycle, provider and conversation modules.
- Reviewed voice-session security, provider architecture/readiness, Phase 12A live-voice approval, Phase 12F contract/security handoff/acceptance documents, and Phase 16 campaign persistence restrictions.
- Static inventory only. No LiveKit room, microphone, STT, LLM, TTS, provider, telephony, SQL, migration, worker lease or Git synchronization was performed.
- Previously reported test evidence was not represented as freshly executed in this assessment.
