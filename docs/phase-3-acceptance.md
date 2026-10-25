# VoicePilot MVP acceptance and provider handover

## Verified locally

- Authenticated organization-scoped dashboard, agents, contacts and campaigns.
- Consent-aware mock campaign orchestration with deterministic queue progress, reset and stale-request protection.
- Mock voice and campaign simulation with synthetic qualification, callback and appointment previews.
- Local JSON/CSV simulation reports marked `SIMULATION ONLY`; exports omit contact identifiers, phone numbers, email addresses and transcripts.
- Isolated local Supabase RLS fixtures and one-worker Playwright coverage.

## Simulation-only boundaries

No real telephone calls, messages, microphone capture, LiveKit rooms, STT, LLM, TTS requests, reminders, calendar events or synthetic business records are created. Provider activation flags remain disabled.

## Future provider requirements

The first real-provider milestone must be an isolated inbound or connectivity-only test with a dedicated tenant and provider project. It requires server-only secrets (for example `TWILIO_*` or `TELNYX_*`, `LIVEKIT_*`, `STT_*`, `LLM_*`, `TTS_*`), private networking, key rotation, signed webhook verification, idempotency keys, bounded retries, distributed rate limiting and audit logs. Never expose these secrets to browser code.

Before any outbound capability, enforce organization membership, consent and opt-out checks, calling hours, emergency stop, per-tenant concurrency, spend/usage quotas, provider failure handling and billing reconciliation. Every webhook and provider event must be tenant-bound and deduplicated.

## Acceptance checklist

- [x] Local auth, RLS and tenant isolation verified with disposable fixtures.
- [x] Mock queue start/pause/resume/stop/reset and authorization invalidation verified.
- [x] Synthetic analytics and private JSON/CSV exports verified.
- [x] Strict isolated E2E server ownership and loopback checks preserved.
- [ ] Separate approval for provider credentials and isolated provider project.
- [ ] Webhook signature, idempotency, emergency-stop and usage-metering review.
- [ ] Human compliance review for consent, calling hours and applicable regulations.
- [ ] Production observability, incident response and rollback plan.
