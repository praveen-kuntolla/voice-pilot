# Phase 31C — Offline voice pipeline integration contract

Status: **offline contract verified; real voice activation remains NO-GO**.

The versioned contract is `offline.voice.pipeline.v1`. It is shared by the
Next.js validation seam and the Python worker tests through
`contracts/offline-voice-pipeline-v1.fixture.json`. It is a local contract
fixture, not a network protocol or public API.

## Session identity and admission

Every session request carries `session_id`, `organization_id`, `agent_id`,
`actor_id`, `expires_at_ms`, `max_turn_chars`, `contract_version`,
`provider_mode`, `simulation_only`, and `no_recording`.

The only accepted provider mode is `mock`; simulation and no-recording are
literal `true`; synthetic input is bounded to 1,000 characters. The existing
server authorization boundary remains responsible for authenticated membership,
same-tenant agent ownership, agent status and session admission. The Python
pipeline rechecks the bound organization, agent and actor before every turn.
Archived agents are rejected at the trusted pipeline construction boundary.

## Events and lifecycle

Events carry the same identity fields, `event_id`, monotonic `sequence`,
nonnegative `turn_id`, `event_type`, `state`, and privacy-safe `metadata`.
Allowed metadata is limited to simulation markers, stage/action labels, text
length and a short SHA-256 prefix. Raw transcript, response, audio or provider
payload fields are rejected.

The allowed state transitions are:

```text
ready -> active | ended
active -> active | interrupted | cancelled | stopped | ended | failed
interrupted -> active | cancelled | stopped | ended
failed -> active | cancelled | stopped | ended
ended -> ended
cancelled, stopped -> terminal
```

Both language implementations reject stale sequence numbers, conflicting event
identifier reuse, cross-session identity, invalid transitions and non-mock
provider mode. Identical replay of an already accepted event is idempotent.
Cancellation, interruption, emergency stop, expiration and cleanup are
terminal/lifecycle events and do not contain raw content.

## Component mapping

| Boundary | Contract responsibility |
| --- | --- |
| Next.js | Validate request/event shape and tenant/session binding before exposing a local test result; no endpoint is added by this phase. |
| Python pipeline | Reuse `ConversationController` and mock provider protocols; project provider events into the privacy-safe contract shape. |
| Authorization | Supply trusted actor, organization, agent, archive status and expiry decisions; client input is not an authorization source. |
| Provider gate | Accept `mock` only; real STT, LLM and TTS adapters remain disabled. |
| Cleanup | Release the process-local session slot even when a mock provider fails. |

## Local versus distributed guarantees

The TypeScript ledger, Python ledger, session registry and pipeline state are
process-local and in-memory. They provide deterministic tests for one process,
but cannot guarantee replay prevention, single-session admission, expiry
coordination, emergency stop, cleanup or authorization revocation across:

- multiple Next.js or worker processes;
- restarts or crashes;
- multiple hosts or regions;
- independently running workers; or
- a real provider or LiveKit control plane.

Those guarantees require the separately approved Phase 12F admission, replay,
lease, trusted-writer and reconciliation design. This phase adds no database,
worker lease, persistence, provider call, LiveKit resource or public API.

## Verification

The shared fixture is validated independently by
`tests/offline-voice-pipeline-contract.test.ts` and
`workers/voice-agent/tests/test_offline_voice_pipeline_contract.py`.
