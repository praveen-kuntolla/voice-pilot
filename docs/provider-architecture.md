# Provider foundations and handover

## Current state

Phase 4 adds typed lifecycle contracts and deterministic offline adapters for telephony, LiveKit, STT, LLM and TTS. They emit synthetic lifecycle events only. Provider activation remains disabled and the existing server authorization, consent and organization checks remain the boundary for all simulation flows.

Webhook verification is a generic offline HMAC fixture contract, not Twilio, Telnyx or LiveKit signature verification. It covers canonical organization/provider/event/timestamp/body bytes, timestamp tolerance and process-local replay claims. Process-local replay storage is suitable only for tests/development; production requires durable distributed replay protection, atomic deduplication, rate limits and provider-specific secret selection/protocols.

## Production control checklist

- Server-only provider secrets with rotation and least privilege.
- Organization membership, consent, opt-out and calling-hour checks before every action.
- Emergency stop, tenant concurrency limits, spend ceilings and usage metering.
- Signed webhook verification, tenant-bound event IDs and idempotent processing.
- Bounded retries only for explicitly retryable failures; no duplicate calls or charges.
- Provider timeouts, circuit breaking, audit events and safe failure states.
- Billing reconciliation, alerting, retention controls and incident response.
- Private networking and observability before enabling any external endpoint.
- Offline policy functions are testable guardrails, not complete production enforcement; usage accounting, distributed limits and authoritative emergency-stop state remain outstanding.
- Phases 4.05–4.08 add review-only durable-safety contracts and a local in-memory adapter. The adapter is test-only, and the accompanying migration is not applied.
- Replay claims, reservations, emergency-stop state and usage accounting require transactional RPCs, durable retention/cleanup, distributed rate limits, metrics and failure drills before provider connectivity.
- The offline organization stop and offline global stop are separate contracts. Both must be available and false before a simulated reservation or usage event can proceed. Neither is an authoritative production switch.
- Migration 012 is review-only. Its replay primary key cannot reclaim an expired event through a plain insert; a future transaction must lock or atomically replace expired rows, reject live duplicates, and clean up expired claims. No such RPC is active. A rollback requires first confirming that no client or worker depends on the new tables, then archiving any synthetic local rows before dropping those tables in reverse dependency order; do not run that rollback against a production database.
- Migration 013 adds review-only transactional routines and a dedicated non-exposed `voicepilot_safety` schema. A disposable-local PostgreSQL harness tests replay/concurrency/budget races and permission boundaries; the established local and remote migration ledgers remain at 011. See [transactional safety](transactional-safety.md) for design, limitations and rollback. No production control is deployed.

## First approved connectivity test

Use a separate provider project and disposable tenant. Populate secrets only in a protected local environment, keep outbound calling disabled, and test one connectivity-only session or provider-specific signed webhook with synthetic data. Verify authorization, replay rejection, disconnect cleanup and cost limits. Capture sanitized logs, then revoke the test credentials. No real provider activation has occurred. This test must be separately approved; this repository does not perform it automatically.

## Future roadmap

1. Add distributed replay/rate-limit storage and signed webhook endpoints behind feature flags.
2. Validate one isolated LiveKit connectivity session with no AI provider or microphone streaming.
3. Add a sandbox telephony inbound test with explicit consent fixtures.
4. Conduct compliance, billing and emergency-stop review before any outbound capability.
