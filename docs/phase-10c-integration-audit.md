# Phase 10C — Integration audit and security hardening

Phase 10C audits the stacked Phase 9–10B.4 architecture without enabling external connectivity. No code path in this audit issues a real LiveKit token, joins a room, requests microphone access, contacts STT/LLM/TTS providers, writes a database record, calls a phone number or sends a message.

## Dependency order

```text
PR #27 Phase 9 call lifecycle
  └─ PR #28 Phase 10A offline provider sandbox
      └─ PR #29 Phase 10B.1 authorization envelope
          └─ PR #30 Phase 10B.2 server/worker admission checks
              └─ PR #31 Phase 10B.3 signed server-to-worker admission
                  └─ PR #32 Phase 10B.4 guarded issuer + offline worker workflow
```

PRs #27–#32 were reviewed as open stacked branches. Earlier PRs #23–#26 and Issue #21 remain separate review dependencies. Automated review is not independent human approval.

## Actual reachable offline flow

The verified offline path is:

1. A test-only guarded issuer creates a versioned HMAC assertion from server-selected synthetic context.
2. The assertion is serialized through the controlled test transport.
3. Python independently verifies the canonical signature, key ID, identity, expiry and disabled-provider policy.
4. The offline workflow consumes the assertion ID and admits one synthetic session.
5. The Phase 9 lifecycle and Phase 10A deterministic mock speech adapters can run without media or network access.
6. Completion or cancellation removes active state and revokes the assertion locally.

The browser is not an authority. Existing protected LiveKit routes still require their existing flags/configuration and are not enabled by this work. The Phase 10B.4 issuer is unavailable unless non-production mode and `VOICE_OFFLINE_ADMISSION_TEST_ENABLED=true` are both present.

## Audit findings

### Fixed or verified

- Tenant identity is checked at the TypeScript and Python boundaries.
- HMAC claims are canonical, versioned, key-identified and constant-time verified.
- Unknown keys, altered claims, malformed signatures, expiry, replay, revocation, emergency stop and concurrency failures reject.
- Provider activation is explicitly false in the sandbox contract.
- Session cancellation/completion removes active state and prevents assertion reuse.
- LiveKit, microphone, provider and outbound flags remain disabled by default.
- Sensitive credentials and raw provider data are not emitted by the offline workflow.

### Not defects in this offline scope

No additional route or duplicate authorization subsystem was added. A public assertion-signing endpoint would be an unsafe expansion and is intentionally absent.

## Readiness matrix

| Control | Status | Evidence / missing acceptance test |
|---|---|---|
| Tenant security | PASS offline / PARTIAL production | TypeScript and Python identity checks; requires authenticated route integration test with real tenant fixtures. |
| Signed admission | PASS offline | Shared TypeScript/Python vector and tamper tests. |
| Durable replay protection | BLOCKED | Process-local sets only; requires atomic distributed claim test across worker instances. |
| Revocation | PARTIAL | Local cancellation revokes state; requires durable worker-visible revocation and JWT/session invalidation test. |
| Emergency stop | PARTIAL | Offline checks fail closed; requires authoritative global control and propagation test. |
| LiveKit authentication | BLOCKED | Existing route is disabled; requires isolated project, short-lived claims and token verification test. |
| Participant termination | BLOCKED | Existing application revocation does not forcibly remove a LiveKit participant; requires room-side termination test. |
| Real STT/LLM/TTS | BLOCKED | Only deterministic adapters exist; requires approved provider adapter contract and outage tests. |
| Microphone privacy | BLOCKED | No browser media path is active; requires permission denial, no-recording and retention tests. |
| Usage/spend limits | PARTIAL | Offline bounded usage exists; requires durable atomic accounting and provider billing reconciliation. |
| Provider failure recovery | PARTIAL | Offline failures are sanitized; requires live adapter timeout, retry and circuit-breaker tests. |
| Key management | BLOCKED | Key ID contract exists; requires server-only secret storage, rotation and retirement test. |
| Monitoring | PARTIAL | Sanitized local diagnostics exist; requires production redaction and alerting review. |
| Human review | BLOCKED | Independent owner/security review remains required. |

## Threat model

Untrusted inputs include the browser, request payloads, worker transport and network. The design rejects client claims as proof, binds assertions to organization/agent/actor/session, authenticates the signature, and fails closed for unavailable policy state. HMAC does not provide transport security, durable revocation or protection if the worker secret is compromised.

## First real browser test prerequisites

Before activation, obtain explicit owner approval for:

1. A separate LiveKit sandbox project and synthetic test identity.
2. Server/worker-only credentials and key rotation procedure.
3. A durable replay/revocation/concurrency/usage store.
4. Provider selection, data regions and retention policy.
5. Microphone consent, no-recording default and deletion procedure.
6. One-session duration and spend ceilings.
7. Emergency-stop operation and participant termination.
8. Exact commands permitted to start the worker and join one room.
9. Authenticated isolated fixtures and cleanup verification.
10. Rollback, credential rotation and incident response plan.

## Audit conclusion

The offline architecture is suitable for independent human review and controlled test preparation. It is not production-ready and is not authorized for real provider connectivity. No additional application-code correction was justified by this audit; the remaining gaps are distributed-state, provider-specific, operational and human-approval requirements.
