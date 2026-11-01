# Phase 9 — Provider-neutral call lifecycle

Phase 9 defines an offline, deterministic call lifecycle contract. It is a foundation for future telephony and realtime integrations, not a live calling implementation.

## State machine

```text
CREATED -> QUEUED -> PREFLIGHT -> AUTHORIZED -> CONNECTING -> RINGING
                                                         -> ANSWERED -> ACTIVE -> COMPLETED
CREATED/QUEUED/PREFLIGHT/AUTHORIZED/CONNECTING/RINGING/ANSWERED/ACTIVE
  -> CANCELLED or FAILED (where supported)
CREATED/QUEUED/PREFLIGHT/AUTHORIZED -> REJECTED
COMPLETED/FAILED/CANCELLED/REJECTED -> terminal
```

The implementation is in `src/lib/call-lifecycle.ts`. `OfflineCallLifecycle` validates events with Zod, binds every event to call/organization/agent identity, rejects stale or invalid transitions, accepts identical event duplicates idempotently, rejects conflicting event-id reuse, bounds history, and marks all records `simulationOnly: true`.

## Authorization and safety

Authorization is supplied by the existing server-authoritative boundary; this module does not replace tenant authorization. The runner accepts an authorization callback and an emergency-stop callback and fails closed when either rejects. It never contacts a provider, opens a media connection, stores customer data, or creates database records.

Event metadata is intentionally limited to simulation-safe fields: a literal simulation marker, bounded duration/usage values, and a redacted reason. Phone numbers, transcript contents, credentials and provider secrets are not part of the contract.

## Idempotency and ordering

`eventId` is the deterministic idempotency key. An exact duplicate returns the current record without changing it. Reusing an event ID with different content is rejected. Event timestamps must be nondecreasing for a call. A durable implementation must enforce these rules transactionally with a unique tenant-bound event key and immutable event evidence.

## Persistence boundary

This phase has no persistence and applies no migration. A future database adapter will need call records, immutable lifecycle events, tenant-scoped ownership, provider references, usage records, retention controls and transactional idempotency. No durability is claimed here.

## Provider boundary

Future telephony, LiveKit, STT, LLM and TTS adapters must map provider-specific events into this contract without assuming identical provider event vocabularies. Each adapter needs documented signature verification, timeout/cancellation behavior, provider reference binding and replay protection. Generic offline events are not real provider verification.

## Verification and limitations

The focused tests cover successful completion, usage metadata, invalid transitions, terminal enforcement, duplicates, out-of-order events, tenant/authorization failures, emergency stop, cancellation, bounded history and sensitive-field exclusion. The runner is not a production call scheduler, webhook receiver, billing system, recording store, or real-time media implementation.
