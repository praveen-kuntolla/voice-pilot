# Phase 11B — Durable Session Authorization

This branch prepares a review-only PostgreSQL foundation for future voice-session admission. Real providers remain disabled.

## Design

`voice_session_authorizations` binds an authorization to one organization, agent, actor, session, and assertion. Unique session and assertion identifiers prevent duplicate consumption. Expiry and revocation are explicit. `voice_session_audit_events` records only security state transitions; it contains no audio, transcript, contact, credential, or signing-secret data.

The schema complements the existing durable safety tables from migrations 012–016. Replay claims, emergency stop, action reservations, and usage reservations remain separate controls and must be consumed in the same server-side transaction before real admission.

## Transaction boundary

Production routines must verify trusted actor/organization context, emergency stop, expiry, revocation, replay, concurrency, and usage in one transaction. A failed check or audit insert must roll back every reservation. Completion and cancellation must release reservations idempotently. The TypeScript memory store in this branch is an offline contract only and is not production durability.

## RLS and privilege boundary

The review-only tables have RLS enabled and no client policies. Client roles must not select or mutate them. Restricted server routines should be granted only to the intended server role, with transaction-local actor and organization context. A service-role connection is not a substitute for a dedicated least-privilege production credential.

## Verification and limitations

Focused unit tests cover validation, tenant mismatch, expiry, idempotent consumption, emergency stop, revocation, and release. PostgreSQL acceptance is **NOT RUN** unless a newly provisioned disposable database is independently verified; established local ledger 001–011 remains unchanged. Durable replay across processes, key management, distributed usage/concurrency, provider-specific controls, and real participant termination remain open production requirements.

## Approval gates

Before applying this migration or enabling a provider, obtain independent security review, verify a disposable acceptance database, prove concurrent claims and rollback, and approve a single-session synthetic sandbox plan. No LiveKit, microphone, STT, LLM, TTS, telephony, or billing operation is authorized by this branch.
