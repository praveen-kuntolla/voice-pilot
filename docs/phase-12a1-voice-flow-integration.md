# Phase 12A.1 — Offline voice-flow integration

This branch adds a server-only admission boundary for a future browser voice session. It is deliberately simulation-only: no LiveKit room is created, no microphone is accessed, no external STT/LLM/TTS provider is called, and no simulated result is persisted.

## Flow

An authenticated server caller supplies a tenant-bound signed admission, a validated session authorization, and the offline session request. `startOfflineVoiceSession` verifies the signature and context, checks the injected policy, and consumes the authorization through the durable-store interface. The current test implementation uses `MemoryDurableSessionAuthorizationStore`; a future approved integration must inject the reviewed PostgreSQL transaction and keep the same fail-closed contract. Cancellation releases the authorization idempotently.

## Safety gates

- `providerActivationEnabled` is a literal `false` and requests with activation enabled are rejected.
- Microphone consent and no-recording are explicit request requirements.
- Organization, agent, actor, session and assertion identities must match across request, authorization and signed claims.
- Expiry, replay, revocation, emergency stop, concurrency and usage policy failures deny admission.
- The browser UI continues to show the voice test as unavailable until a separately approved provider implementation exists.

## Review-only database boundary

Migration 019 is review-only in this phase. It must only be applied to a newly randomized disposable acceptance database by the approved Linux harness; the established local ledger and remote Supabase are not changed.

## Not yet verified

This branch does not claim PostgreSQL acceptance or authenticated browser voice-session coverage. Those require the approved disposable fixtures and the existing isolated CI environment. Phase 12B requires explicit owner approval for provider selection, server-only credentials, durable admission, usage limits, emergency stop, retention, rollback, and a bounded connectivity test.
