# Provider integration readiness

## Current boundary

This project has no configured external AI credential and no real provider adapter. The only executable choice remains deterministic `mock`. Provider metadata is a local validation registry, not evidence of a commercial provider integration, support agreement, or compliance certification.

## Approval model

Real provider use must pass every server-side gate: environment activation (`VOICE_PROVIDER_ACTIVATION_ENABLED=true`) set only in worker/server deployment; independently enabled worker and realtime gates; organization and agent approval for each provider; capability validation for model/language/voice; a credential reference that resolves through a managed secret store; and consent, regional, retention, quota, and budget checks. Any missing check fails closed. There is no fallback from rejected real selection to mock, and local settings never create an external connection.

## Credential strategy

Keep production provider credentials in a managed secret store with separate development, staging, and production namespaces. Store a reference and rotation metadata, not plaintext, in application configuration. A future implementation needs least-privilege runtime identities, auditable reads, dual-key rotation, revocation, and an emergency deny switch. The local `MockSecretStore` exists only for tests. Status checks return a boolean and a non-secret reference fingerprint; errors and diagnostics must never include a credential or complete provider request.

## Privacy, quotas, and diagnostics

Before live processing, attach a tenant policy for audio/transcript retention, consent, permitted processing regions, diagnostic redaction, deletion workflow, and provider disclosure text. This is application architecture, not a legal/compliance assessment. Diagnostics use correlation IDs and metadata only; they do not store conversation content by default.

The local ledger supports deduplicated STT seconds, LLM input/output tokens, and TTS characters with organization/session limits and concurrency checks. Pricing values are manual estimates, not provider invoices. Production needs an atomic distributed ledger, currency/rounding policy, reconciliation, alerts, and hard termination for active sessions over budget.

## Isolated future integration procedure

Only after explicit approval: create separate provider test accounts with minimum scope, spending alerts/limits, short-lived test credentials, and an isolated LiveKit project. Use disposable consented synthetic audio, one provider at a time, strict request caps, rollback/kill switch, and redacted telemetry. Verify activation gates, capability validation, timeout/cancellation, deletion, quota enforcement, and credential rotation. Disable flags, revoke test credentials, delete test artifacts, and review logs afterward. This procedure does **not** authorize any request.

## Remaining production blockers

- Managed secret-store integration and credential-rotation workflow.
- Persistent organization/agent approvals, privacy policies, audit log, and distributed usage ledger migrations plus RLS verification; the local migration design is documented in [provider-governance-persistence.md](provider-governance-persistence.md).
- Provider-specific legal, data-processing, regional, retention, and cost review.
- Approved isolated provider and LiveKit integration tests.
- LiveKit JWT/participant revocation and production Redis HA/TLS/ACL work.
