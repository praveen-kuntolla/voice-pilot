# Phase 10B.4 — Signed admission integration and offline end-to-end verification

This milestone connects the signed assertion contract to a controlled offline issuer and Python worker workflow. It never issues a LiveKit token, creates a room, requests microphone permission, contacts a provider, generates audio, writes a database record, or performs telephony.

```text
test-only guarded server issuer
        │ signed canonical assertion
        ▼
controlled offline transport → Python verifier
        │ identity + expiry + replay + policy
        ▼
offline admission → Phase 9 lifecycle / Phase 10A mock adapters
        │ cancel or complete
        ▼
revocation + cleanup; terminal sessions cannot restart
```

The TypeScript issuer is unavailable unless `NODE_ENV` is non-production and `VOICE_OFFLINE_ADMISSION_TEST_ENABLED=true`. It uses the authenticated server-selected context supplied by its caller; browser claims are not an authority. The worker independently verifies the signature, key ID, identity, expiry, capability and policy before admission.

The process-local workflow consumes assertion IDs atomically, tracks active sessions, revokes on cancellation/completion and rejects replay, tenant mismatch, emergency-stop and unavailable concurrency. This is deterministic test state, not production authority. Durable Redis/PostgreSQL state is required for cross-process replay, revocation, leases, usage ceilings and global emergency stop.

## Privacy and safety

Only synthetic IDs and aggregate usage metadata are used. Secrets never cross the browser boundary. Provider flags remain disabled. Failure and cleanup paths do not start LiveKit, STT, LLM or TTS connectivity.

## Production prerequisites

Before any external test: authenticated route integration, durable state, server/worker key management and rotation, provider-specific governance, short-lived token binding, real participant termination, microphone consent, retention policy, monitoring and owner approval must be completed.
