# Phase 8 — Offline voice profile foundation

## Implemented

The Agent Builder now links to `/dashboard/agents/voice-preview`, an authenticated dashboard route with three deterministic, synthetic voice profiles. The preview returns text metadata only: it does not create audio, call STT/LLM/TTS providers, persist sample text, or contact LiveKit or telephony services.

Profile selection is validated against the agent language family and sample text is bounded to 240 characters. The catalog uses stable `mock-*` identifiers and is intentionally not a provider registry or production voice availability claim.

## Boundaries

- This is an offline simulation foundation, not a voice-quality or provider-connectivity test.
- No credentials, audio buffers, recordings, customer data, database writes, or external requests are involved.
- Real provider adapters, voice billing, consent enforcement for calls, and production observability require separate design and approval.
- Phase 7 Knowledge Lab remains on draft PR #23 and is not a dependency of this milestone.

## Verification

- Focused voice-profile tests: 3 passed.
- Full Vitest: 253 passed, 20 skipped.
- Python worker tests: 51 passed.
- TypeScript, ESLint, production build, and `git diff --check`: passed.
- Authenticated Playwright: not run in the clean worktree because approved isolated Supabase fixture configuration was unavailable there.
