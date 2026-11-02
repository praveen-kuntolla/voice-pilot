# Phase 29A — Voice Connectivity Approval Coordination

## Current decision

**NO-GO.** No independent approval record exists for the first disposable LiveKit browser-connectivity acceptance. All six reviewer decisions remain **PENDING**. Local contract tests, configured credentials, the Phase 28 offline demo, and the Phase 27 browser baseline do not constitute approval.

The Phase 28 demo remains approved only for local offline simulation at `http://127.0.0.1:3402`.

## Required reviewers and decisions

| Reviewer | Decision responsibility | Status |
| --- | --- | --- |
| Voice platform owner | Isolated LiveKit test project/host, room and participant cleanup authority, provider-side termination | PENDING |
| Database/security owner | Admission, replay, rate-limit and least-privilege boundary; explicit exclusion of production and Phase 16 data; Phase 12F prerequisite disposition | PENDING |
| Platform/security owner | Secret-manager references, worker-key lifecycle, token claims, identity binding and egress | PENDING |
| SRE/release owner | One-session limit, hard timeout, monitoring, rollback, watchdog, cleanup operator and failure recovery | PENDING |
| Privacy/compliance owner | Synthetic identity, no recording, no external AI processing, retention and deletion of evidence | PENDING |
| Product/safety owner | Manual start/stop, emergency shutdown and explicit non-telephony/non-campaign scope | PENDING |

## Reviewer requests

### Voice platform owner

Please approve or reject one connectivity-only session in a newly identified disposable LiveKit project. Confirm the project host, room naming scope, participant identity policy, provider-side termination method, room cleanup owner and credential revocation procedure. The request excludes microphone permission, audio publication, STT/LLM/TTS, telephony and customer data.

### Database/security owner

Please review the admission and replay boundary for this exact test. Confirm whether the test may use the approved non-production mock/test-store seam, or identify the Phase 12F controls that must be closed first. Confirm no production Supabase data, Phase 16 tables, migrations or durable campaign authority are involved. Review same-tenant binding, forged identifiers, nonce replay, expiry, rate limits and one-session enforcement.

### Platform/security owner

Please approve the secret-manager references, server/worker-only access, short-lived token claims, tenant/agent/session binding, origin checks, egress allowlist, key rotation and revocation plan. Confirm that no LiveKit secret, worker key, service-role key or provider credential can appear in browser code, fixtures, screenshots or logs.

### SRE/release owner

Please approve the operational envelope: one concurrent session, short hard timeout, manual named operator, watchdog, health checks, stop controls, emergency denial, crash recovery, sanitized evidence, cleanup verification and rollback. Confirm the active port-3402 demo and unrelated Docker resources are outside the test lifecycle.

### Privacy/compliance owner

Please approve synthetic-only identity and content, no microphone/audio, no recording, no external AI processing, no phone numbers, no customer data, retention duration for sanitized evidence and deletion of all test artifacts and credentials.

### Product/safety owner

Please approve the product boundary: this is a browser connectivity acceptance only, not an AI conversation, campaign execution, outbound call, messaging workflow or telephony test. Confirm manual start/stop, emergency shutdown and the user-facing wording required to prevent a live-capability misunderstanding.

## Exact proposed test boundary

The test may proceed only after all six signed decisions are recorded and must remain limited to:

- One newly approved disposable LiveKit project.
- One synthetic user, organization and agent.
- One concurrent browser session with a short hard timeout.
- Mock provider mode with **zero STT, LLM and TTS requests**.
- No microphone permission, audio publication, recording, phone number, SIP, telephony, messaging or outbound call.
- No production Supabase, production LiveKit, customer data, Phase 16 objects or campaign dispatch.
- Server/worker-only secrets held by managed reference; no secret in browser, fixture or log.
- No SQL, migration or Phase 12F implementation during the acceptance.
- Zero external AI/telephony spend and no automatic retry after uncertainty.

## Evidence required before any GO

1. Named project/host and disposable-environment inventory.
2. Secret-manager references, access audit, key expiry, rotation and revocation evidence.
3. Independent token verification showing exact room/session scope, short expiry and no publish/data/SIP/admin grants.
4. Same-tenant and forged-tenant/agent/room/participant rejection evidence.
5. One-session, duplicate-consumption, replay, expiry, restart and rate-limit evidence.
6. Named emergency-stop operator plus evidence of blocked admission, termination, reconciliation and uncertain-cleanup handling.
7. No-recording/no-provider/no-telephony proof and evidence-retention/deletion decision.
8. Cleanup inventory showing room, participant, reservations, fixtures, logs and credentials removed or revoked.
9. Explicit disposition of Phase 12F findings affecting admission, trusted evidence production and reconciliation authority.

## Decision-record format

Each reviewer must provide a separate signed record using this exact structure:

```text
Phase: 29A
Reviewer role:
Reviewer name/identifier:
Decision: APPROVED | CONDITIONALLY APPROVED | REJECTED
Environment/project identifier:
Approved boundary:
Conditions or blockers:
Evidence links/locations:
Decision date (UTC):
Signature or organization-approved attestation:
```

The coordinator must append the signed record to the review package or an access-controlled evidence register and update the matrix only when the role, explicit decision, date and evidence location are present. Until then, the matrix remains PENDING. A later approval applies only to the exact environment and boundary named in the record.

## Authorized-future-test checklist

Before start:

- Verify all six decisions are signed, dated and attached.
- Verify the project and credentials are disposable, isolated and not production.
- Verify mock mode, no-audio, no-recording, no-provider and no-telephony flags.
- Verify synthetic tenant/user/agent and one-session limit.
- Verify manual operator, watchdog, hard timeout and emergency-stop path.
- Capture a preflight snapshot without secrets.

During test:

- Start one named session only.
- Do not grant microphone permission or publish audio.
- Reject any tenant, room, participant, replay, expiry or accounting uncertainty closed-loop.
- Stop immediately on boundary violation; do not retry indefinitely.

After stop:

- Confirm provider-side room/participant termination, if any resource was created.
- Confirm reservations and worker/test-store state are reconciled.
- Revoke test credentials and remove test fixtures.
- Verify no recording, provider request, telephony event, customer data or billing side effect exists.
- Store sanitized evidence and obtain reviewer sign-off on cleanup.

## Existing evidence and limitations

Phase 26C records 25 focused local contract tests as prior evidence; they did not create a LiveKit resource or request microphone media. Phase 27C records two clean 28/28 offline authenticated browser runs. Phase 28A/28B establish a reproducible local offline demonstration and checkpoint. None of these records proves external LiveKit connectivity, distributed one-session enforcement, provider-side termination, production worker authority or telephony safety.

## Verification performed for Phase 29A

- Read `AGENTS.md` and reviewed the Phase 26A, 26B, 26C and Phase 28A documents.
- Confirmed the six approval roles remain PENDING; no decision was changed.
- No LiveKit room or token was created.
- No microphone, provider, telephony, recording, SQL, migration or external service was used.
- The Phase 28B checkpoint and port-3402 demo were not modified or interrupted.
