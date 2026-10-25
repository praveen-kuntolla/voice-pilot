# Provider foundations and handover

## Current state

Phase 4 adds typed lifecycle contracts and deterministic offline adapters for telephony, LiveKit, STT, LLM and TTS. They emit synthetic lifecycle events only. Provider activation remains disabled and the existing server authorization, consent and organization checks remain the boundary for all simulation flows.

Webhook verification now covers an organization-bound event identity, HMAC signature, timestamp tolerance and process-local replay claims. Process-local replay storage is suitable only for tests/development; production requires a durable distributed store and atomic deduplication.

## Production control checklist

- Server-only provider secrets with rotation and least privilege.
- Organization membership, consent, opt-out and calling-hour checks before every action.
- Emergency stop, tenant concurrency limits, spend ceilings and usage metering.
- Signed webhook verification, tenant-bound event IDs and idempotent processing.
- Bounded retries only for explicitly retryable failures; no duplicate calls or charges.
- Provider timeouts, circuit breaking, audit events and safe failure states.
- Billing reconciliation, alerting, retention controls and incident response.
- Private networking and observability before enabling any external endpoint.

## First approved connectivity test

Use a separate provider project and disposable tenant. Populate secrets only in a protected local environment, keep outbound calling disabled, and test one connectivity-only session or signed webhook with synthetic data. Verify authorization, event signature, replay rejection, disconnect cleanup and cost limits. Capture sanitized logs, then revoke the test credentials. This test must be separately approved; this repository does not perform it automatically.

## Future roadmap

1. Add distributed replay/rate-limit storage and signed webhook endpoints behind feature flags.
2. Validate one isolated LiveKit connectivity session with no AI provider or microphone streaming.
3. Add a sandbox telephony inbound test with explicit consent fixtures.
4. Conduct compliance, billing and emergency-stop review before any outbound capability.
