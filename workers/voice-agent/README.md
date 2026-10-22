# VoicePilot voice-agent worker

This is the boundary for a future LiveKit Agents worker. The framework entrypoint is implemented, but worker and realtime flags remain disabled by default; local tests do not connect to LiveKit, AI providers, telephony or external services.

## Runtime flow

`join authorized room -> load validated agent config by organization -> greeting -> listen -> STT -> LLM -> TTS -> repeat -> end`

The worker must never use a client-provided organization ID to fetch configuration. The token service authorizes the user and agent, while the worker must verify the room naming convention and fetch the agent using both `organization_id` and `agent_id` under a server-side credential.

## Provider adapters

Implement separate adapters for speech-to-text, LLM and text-to-speech. Required future settings are provider name, model, language, voice ID, timeout and maximum response length. Keep provider keys in worker-only environment variables.

## Future startup

An approved connectivity-only test can use the guarded launcher and a private
`.env.livekit-test.local` file. It joins an isolated room without STT, LLM, TTS,
microphone publication or calling. See [the connectivity test procedure](../../docs/livekit-connectivity-test.md).

Real AI provider adapters are not yet implemented. The real-provider branch
fails before a LiveKit job is registered. Until a separate integration is
approved, use the dashboard mock console and `mockConversation()` only.

Required future flags remain disabled by default:

`VOICE_REALTIME_ENABLED=false`

`VOICE_CONNECTIVITY_TEST_ENABLED=false`

`VOICE_WORKER_ENABLED=false`

`VOICE_OUTBOUND_ENABLED=false`

`VOICE_PROVIDER_ACTIVATION_ENABLED=false`
