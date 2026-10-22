# Voice provider architecture

## Scope and boundary

Phase 3.14 provides a provider-neutral, local-only execution model. It does
not import an AI-provider SDK, open a media device, publish audio, or make a
network request. `mock` is the only constructible provider mode. `deepgram`,
`openai`, and `elevenlabs` are validation-only future identifiers; requesting
real mode fails closed.

## Contracts

The Python worker's `providers.py` defines:

- STT transcript chunks, including partial and final markers, with language.
- LLM messages and response chunks. A tool name is an observable request only;
  the local controller emits a diagnostic and never executes a tool.
- TTS byte chunks, with final markers and voice selection.

The Next.js local controller has the same event boundary for the browser
simulator. All runtime configuration is organization and agent scoped, contains
bounded instructions and knowledge-source IDs, and validates provider category
compatibility before use.

## Conversation lifecycle

`idle → listening → transcribing → thinking → speaking → idle` is a successful
turn. A cancellation enters `interrupted → idle`; a provider timeout or error
enters `failed`; session close enters `ending → ended`. Each event has a
monotonic sequence and turn ID. A newer turn, interruption, or session end
invalidates stale output. The Python and browser histories are bounded, so a
long session cannot retain unbounded transcript events.

## Simulator

The authenticated agent test console contains **Simulation — No Live Audio**.
It accepts typed simulated speech and can model a successful, slow, failed, or
empty provider outcome. The display is event text only: it captures no
microphone input, creates no playable audio, calls no provider, and executes
no tool. This is a development aid, not proof of live speech quality.

## Future provider integration gate

Any real adapter requires a separate approved change: server-side secret
manager configuration, provider-specific data processing and retention review,
language/voice capability tests, strict timeouts and cancellation, telemetry
redaction, quotas/cost limits, and isolated integration tests. Credentials must
remain worker/server only and must never reach browser bundles. Realtime,
worker, connectivity, and outbound calling flags remain disabled by default.
See [provider-integration-readiness.md](provider-integration-readiness.md) for
the approval matrix, credential-reference model, and local privacy/usage gates.
