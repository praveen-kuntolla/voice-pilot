# Phase 12A Browser Voice Preparation

## Status

This phase prepares a future browser voice sandbox only. The OUTLIVO UI keeps
the Test Voice Agent action disabled. No microphone permission, LiveKit room,
token, provider request, audio generation, billing or customer data is used.

## Proposed architecture

Authenticated browser → server authorization envelope → PostgreSQL session
lease and usage reservation → LiveKit room admission → approved worker gateway
→ STT / LLM / TTS adapters → browser audio. Every edge must retain the
organization, agent, actor and session identity. A missing approval, disabled
provider, expired lease, emergency stop, quota failure or cleanup failure must
deny admission.

The existing offline provider contracts remain the test boundary. Their TTS
output is synthetic bytes or text and must never be described as speech.

## Provider options for a separately approved test

| Option | Strength | Decision status |
| --- | --- | --- |
| LiveKit + approved realtime model | Fewer streaming boundaries and native interruption handling | Not selected; requires owner approval and provider-specific review |
| LiveKit + separate STT, LLM and TTS | More replaceable components and independent language choices | Recommended architecture for the first isolated test, pending provider selection |
| Existing adapter boundary | Lowest code churn and strongest offline continuity | Current implementation; provider-disabled only |

Provider-specific capability, retention, latency and pricing claims must be
confirmed from the vendor’s current documentation immediately before approval;
this repository intentionally does not embed guessed prices. Reference
documentation: [LiveKit Agents](https://docs.livekit.io/agents/), [OpenAI Realtime](https://platform.openai.com/docs/guides/realtime), [Deepgram streaming](https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio), and [ElevenLabs streaming](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream).

## Required controls

- Server-only provider credentials and a separate sandbox project.
- One concurrent session per organization during the first test.
- Hard session duration, usage-unit and spend ceilings.
- Explicit microphone consent; no recording by default.
- Signed admission bound to organization, agent, actor and session.
- Durable lease, usage reservation, reconciliation and emergency-stop checks.
- Provider disconnect and webhook confirmation before considering termination complete.
- Sanitized logs and no transcript/audio persistence unless separately approved.
- Immediate rollback by disabling provider flags, revoking sandbox credentials and
  stopping the worker gateway.

## Approval checklist

Before activation, the owner must approve the exact provider stack, sandbox
accounts, credentials, retention settings, usage ceiling, test identity,
emergency-stop procedure, provider terms, network egress policy and rollback
owner. An independent PostgreSQL/Supabase and voice-platform security review is
required; Codex and CI are not human approval.

## Current implementation boundary

Implemented offline: typed request validation requiring explicit consent and
`providerActivationEnabled=false`, deterministic provider adapters, disabled
voice-test UI, existing signed admission, durable session/usage foundations and
worker fail-closed contracts. Not implemented: real browser audio, provider
connectivity, provider-side participant removal, live usage reconciliation and
production retention enforcement.
