# Phase 10A — Voice provider sandbox readiness

Phase 10A prepares a future browser-to-AI voice test without activating any real provider.

## Architecture

```text
Browser microphone (disabled)
        ↓ future approved transport: LiveKit boundary
STT stream → LLM response stream → TTS audio stream
        ↓
Phase 9 tenant-bound call lifecycle
        ↓
usage metadata / redacted events / terminal state
```

The current implementation uses `OfflineVoiceSandboxSession` and deterministic mock STT, LLM and TTS adapters in `src/lib/voice-sandbox.ts`. It produces text events and synthetic audio-chunk labels only. It does not capture a microphone, create audio, open a room, call an API, persist a call, or contact a provider.

## Provider-neutral contracts

The adapters expose streaming-compatible boundaries for partial/final STT, LLM response events, TTS chunk events, cancellation, failures and usage metadata. `OfflineVoiceSandboxSession` reuses Phase 9 `OfflineCallLifecycle` for authorization, emergency-stop, tenant identity, terminal state and deterministic completion.

## Candidate future stack

The existing LiveKit architecture is the preferred transport boundary because the repository already has LiveKit room naming, token authorization, worker authentication, session termination and connectivity-only launcher controls. A future approved sandbox could use LiveKit for media/session transport, one STT provider, one LLM provider and one TTS provider. Provider-specific adapters must remain server/worker-side and translate events into the Phase 9 contract.

Provider selection is intentionally deferred. Cost, language coverage, latency, retention, regional processing, interruption support and terms must be compared against the chosen sandbox project before activation. No provider estimate is treated as an authorization or current price commitment.

## Security boundaries

- `microphoneEnabled`, provider requests and real-time activation are false in the offline configuration.
- No provider credentials are accepted by the offline adapter.
- Authorization is tenant-bound and delegated to the existing server-authoritative boundary.
- Emergency stop and cancellation fail closed.
- Events are bounded and metadata excludes phone numbers, transcript contents, secrets and URLs.
- No database writes or migrations are included.

## Future Phase 10B approval checklist

Required before any live test:

1. Separate provider sandbox/project and synthetic or owned test identity.
2. Server/worker-only credentials stored in a private local environment file or secret manager.
3. Explicitly enabled, time-limited feature flags with a default-off rollback.
4. Consent, calling-hours, opt-out, emergency-stop, concurrency and spend limits verified.
5. Provider-specific webhook/signature and replay design reviewed.
6. Retention and deletion policy for audio/transcripts approved.
7. One browser session, one agent, one room and one test identity only.
8. Monitoring, redacted logs and cleanup procedure prepared.
9. Manual approval before starting the worker or joining any room.

## Current limitations

The offline runner is not durable, not a scheduler, not a billing system, not a webhook receiver and not proof of provider compatibility. Authenticated browser verification for a future live-provider sandbox is not part of Phase 10A.
