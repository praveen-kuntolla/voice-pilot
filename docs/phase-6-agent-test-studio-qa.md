# Phase 6 Agent Test Studio QA

## Scope

The Agent Test Studio is a local, deterministic simulation. It supports a bounded multi-turn session, five synthetic scenario presets, server-verified agent preflight before every turn, interruption, reset, end, and reviewed local transcript previews. The UI is explicitly labelled **SIMULATION ONLY — NO AUDIO / NO LIVE PROVIDERS**.

## Safety properties

- No microphone, LiveKit, STT, LLM, TTS, telephony, messaging, or external provider request is made by the mock runtime.
- The browser sends no organization identifier as an authorization claim. Each turn calls the authenticated server preflight endpoint, which resolves the selected organization and agent ownership server-side.
- Sessions are held in React memory only. Reset, agent changes, unmount, and stale request generations clear the controller and suppress late responses.
- Input is bounded to 1,000 characters and a session is bounded to eight turns and 200 retained events.
- Failed sessions require reset; interrupted sessions return to idle; ended sessions cannot accept new turns.
- Export remains local-only and requires review. It contains no contact records or credentials, but redaction is best effort and user review is required.

## Verification checklist

| Check | Result |
| --- | --- |
| Runtime schema and tenant scoping | Focused Vitest |
| Ordered multi-turn event timeline | Focused Vitest |
| Preset validation and deterministic modes | Focused Vitest |
| Duplicate active turn rejection | Focused Vitest |
| Input and event bounds | Focused Vitest |
| Interrupt, end, failure and reset lifecycle | Focused Vitest / authenticated E2E when fixtures are available |
| Agent ownership and organization authorization | Existing server preflight plus authenticated E2E when fixtures are available |
| No external provider requests | Authenticated E2E request assertion when fixtures are available |
| Export preview | Existing and Phase 6 authenticated E2E when fixtures are available |

Authenticated browser tests require the approved isolated local Supabase fixtures and `E2E_ISOLATED_AUTH=true`. They must not use production credentials or records. If fixtures are unavailable, the authenticated checks remain skipped rather than being represented as passed.

## Limitations and follow-up

The runtime is intentionally mock-only. It does not prove provider connectivity, audio quality, real-time latency, billing behavior, consent enforcement for real calls, or production tenant isolation. A future provider test requires a separately approved isolated environment, server-only credentials, distributed replay/rate limiting, and an explicit emergency-stop procedure. No migration or provider activation is part of Phase 6.
