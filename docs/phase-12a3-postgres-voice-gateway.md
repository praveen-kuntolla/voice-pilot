# Phase 12A.3 — PostgreSQL voice-session gateway

This branch connects the existing offline voice-session contract to the reviewed
PostgreSQL routines from migrations 017–019. It remains test-only and
simulation-only: the adapter creates no LiveKit room or token, requests no
microphone permission, calls no STT/LLM/TTS provider, and writes no audio or
transcript.

## Runtime flow

An already-authenticated server boundary validates organization membership and
agent ownership, verifies the signed assertion and authorization identity, then
executes `consume_voice_session_authorization` through the injected
`PostgresTransactionExecutor`. The SQL routine performs tenant-bound checks,
expiry/replay handling, emergency-stop checks, concurrency accounting and usage
reservation under transaction-local actor and organization context. Release
uses `release_voice_session_authorization` and is idempotent. Authorization
creation uses `create_voice_session_authorization`, which records sanitized
audit evidence.

The adapter requires `disposableEnvironment=true`; it does not silently fall
back to the memory store. The pool must be created with the existing
`createDisposableLocalGatewayPool` guard and the reviewed server-only role.

## Acceptance boundary

Migrations 017–019 are review-only and may be applied only to a newly
randomized disposable PostgreSQL database by the approved Linux harness. The
established local ledger 001–011 and remote Supabase must not be modified.
Required acceptance includes tenant mismatch, agent ownership, replay and
idempotency, concurrency/usage exhaustion, emergency stop, database failure,
rollback, cross-process consistency, release idempotency and cleanup.

## Current limitations

The adapter and contract tests are present, but this worktree does not contain
approved fixture metadata, so authenticated browser and disposable PostgreSQL
acceptance are not claimed until the isolated environment is available. The
voice UI remains disabled and no real provider connectivity is authorized.

## Phase 12B runtime boundary

The protected `/api/voice-session/offline` route wires authenticated
organization/agent selection to the PostgreSQL adapter, but it can run only
when `VOICE_SESSION_POSTGRES_DISPOSABLE=true`,
`VOICE_OFFLINE_ADMISSION_TEST_ENABLED=true`, a loopback disposable
`GATEWAY_DATABASE_URL`, and a server-only test secret are present. It is never
enabled in production and never falls back to memory. It remains text/session
state only; it does not issue LiveKit tokens or request a microphone.
