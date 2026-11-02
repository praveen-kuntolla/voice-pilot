# Phase 12F.1 — Trusted worker lease and reservation release design

Status: review-only. This document does not enable providers, add an endpoint, or apply SQL.

## Existing trust boundary

The browser authenticates through Supabase and selects an organization-owned agent in `src/app/api/voice-session/offline/route.ts`. The durable path creates and consumes `public.voice_session_authorizations` through the SQL routines introduced by migrations 017–018. The release routine requires request-local `request.jwt.claim.sub` and `voicepilot.organization_id` claims and updates only the exact organization/actor/session row.

The worker configuration boundary is `src/app/api/internal/voice-agent/config/route.ts`. `verifyWorkerRequest()` authenticates the shared HMAC secret, bounds timestamps, consumes a single-use nonce, and the route validates the authorized room and organization/agent ownership before consuming room authorization. Python `run_agent_session()` invokes its `ReservationReleaser` on success, failure, and cancellation and fails closed when release is not confirmed.

The safe binding moment is the successful server-side worker-config transaction: after HMAC/nonce verification, room authorization consumption, authoritative organization/agent lookup, and validation of the authorized participant/session identity. A lease must be created in that same trusted transaction, or in a transaction that locks and verifies the consumed authorization before inserting the lease. Browser or worker request-body identifiers are never authoritative.

## Proposed lease

The review-only SQL proposal is [20261101_phase12f_worker_leases.sql](C:\Users\PC\Documents\ChatGPT\voicepilot-livekit-codex\docs\review-only\20261101_phase12f_worker_leases.sql). It adds `voicepilot_safety.worker_session_leases` with:

- UUID lease, authorization, assertion, organization, agent, actor, session, room, and participant identities;
- worker key identifier, status, version, created/expiry/released timestamps, and redacted audit metadata;
- foreign keys to the durable authorization and organization/agent records;
- unique authorization/session/assertion bindings and indexes for reconciliation;
- RLS denial for client roles and service-role-only mutation;
- a monotonic state model: `active → releasing → released`, or `active → expired → reconciliation_required`;
- no transition from `expired` to `released` without an authoritative termination/reconciliation decision.

The proposed migration is not applied and intentionally does not create an HTTP route.

## Atomic creation

The config endpoint should, after existing validation, begin one service-role transaction, set request-local actor and organization claims, lock the authorization row, require matching organization/agent/actor/session/assertion/room/participant values and `consumed_at IS NOT NULL`, reject released/revoked/expired records and emergency stop, then insert one active lease. The worker response should contain only the lease ID and server-derived runtime identity. A failed lease insert rolls back config consumption or leaves the authorization in a state that cannot authorize worker execution.

## Proposed release contract

`POST /api/internal/voice-agent/release`

Headers use the existing canonical HMAC format: method, exact path, bounded millisecond timestamp, fresh nonce, and exact compact JSON body. The body contains only `lease_id`, `release_attempt_id`, `reason`, and a termination-confirmation state; it does not supply organization, actor, agent, session, room, or participant authority.

The server verifies the worker key and key ID, timestamp window, nonce uniqueness, body size/schema, and key rotation status before database access. It locks the lease by ID, derives every identity from the lease and joined authorization row, verifies the key is allowed for that lease, and invokes the existing tenant-bound release RPC in the same transaction. The release attempt is idempotent: an already released lease returns success without a second transition; a mismatch, stale key, missing lease, or active-provider uncertainty is terminal and does not free capacity.

Suggested responses: `200` for released/already released, `401` for invalid HMAC/key, `409` for replay or lease/state conflict, `422` for invalid request shape, `404` for an unknown lease without revealing tenant existence, and `503` for durable database failure. Response bodies contain no SQL errors, credentials, room data, or customer data.

## Emergency stop and recovery

Emergency stop first blocks new admission and provider work. The control plane then requests provider/media termination, records the termination result, and only releases the exact lease when termination is confirmed. If termination is unavailable, the lease becomes `reconciliation_required` and capacity remains reserved.

Worker retries use the same lease and logical release attempt but a fresh nonce per signed request, with bounded exponential backoff. `released` and `already released` are terminal success. Invalid authentication, identity mismatch, replay, or expired signature is not retried with altered identifiers. If the worker or network fails, expiry reconciliation locks only leases whose expiry has passed, verifies no active provider/session signal remains, and otherwise retains the lease for operator reconciliation. Expiry alone never proves provider termination.

## Threat model and test matrix

| Case | Required assertion |
|---|---|
| Forged HMAC / wrong key | 401; no SQL release |
| Expired timestamp | 401; nonce not accepted |
| Replayed nonce | 409; release state unchanged |
| Altered body/path/method | signature failure; no release |
| Cross-tenant lease ID | 404/409 without capacity release |
| Wrong worker key ID | rejected before lease mutation |
| Wrong room/participant/agent | server-derived lease mismatch; no release |
| Duplicate callback | one state transition and one audit event |
| Concurrent callbacks | row lock yields one release; other is idempotent |
| Database outage / timeout | 503; reservation remains active |
| Worker crash | expiry/reconciliation only, exact lease binding |
| Emergency stop | new work blocked; active provider termination precedes release |
| Provider still active | no released state; reconciliation required |
| Tenant RLS | client roles cannot read or mutate leases |

## Decisions requiring independent approval

1. Worker credential model: one rotatable service key per worker pool or per worker identity.
2. Authoritative provider termination signal and maximum reconciliation age.
3. Whether the lease is created in the existing config transaction or a new combined SQL RPC.
4. Exact least-privilege database role allowed to invoke release.
5. Audit retention and whether worker/key identifiers are considered sensitive.
6. Operational behavior when release confirmation is unavailable: retain capacity indefinitely, bounded expiry, or operator approval.
7. Migration review, deployment ordering, and rollback strategy.

Until these decisions and the additive migration are approved, live worker release and provider activation remain NO-GO.

## Phase 12F.1B remediation matrix

| Finding | Proposed correction | Enforcement | Required test | Remaining risk / approval |
|---|---|---|---|---|
| Atomic creation | Move room authorization authority into PostgreSQL and use one creation RPC | Lock authorization and room-binding rows, consume, then insert lease in one transaction | Inject lease insert failure and assert authorization/lease rollback | Requires replacing the current separate security-store authority; approval required |
| Cross-tenant binding | Accept only authorization ID and server-derived values | RPC joins authorization, organization, agent, actor, room, participant and key rows | Wrong tenant/agent/actor/session/assertion/room/participant | Requires composite relationship constraints and independent review |
| Worker key binding | Add worker-key registry and lease key FK | Active/revoked/expiry checks inside auth and release RPCs | Rotation overlap, revoked key, wrong key ID | Key provisioning/rotation owner unresolved |
| State transitions | Remove direct table writes and use transition RPCs | `FOR UPDATE`, expected version, explicit allowed transitions | Concurrent release and illegal transition matrix | Provider termination evidence contract unresolved |
| Privileges | Service-role-only RPCs with secure search paths | Revoke table access; grant only RPC execution to gateway role | Anonymous/authenticated/direct worker table access denied | Least-privileged role must be approved |
| Room/participant authority | Persist validated binding in the same database as the lease | Foreign key and RPC equality checks | Substituted room or participant | Requires migration from the current Redis/security store |
| HMAC/replay | Add signed key ID and scoped nonce claim | Key registry lookup plus nonce `(key_id,path,nonce)` uniqueness | Altered body/path, replay, expiry, rotation | Replay store durability and retention require approval |
| Active uniqueness | One immutable lease per authorization | Unique authorization/session/assertion constraints plus creation lock | Concurrent duplicate creation | Historical retention policy unresolved |
| Audit safety | Typed reason/status columns and append-only events | Bounded enum/checks; no free-form secrets | Credential/token/customer-data injection | Audit retention decision unresolved |
| Emergency stop | Termination evidence precedes release | Release RPC rejects unconfirmed provider state | Emergency stop with provider still active | Provider termination signal not defined |
| Expiry/reconciliation | Expiry creates reconciliation work, not automatic release | Reconciler locks exact lease and requires termination evidence | Crash, timeout, stale provider session | Operator/SLO ownership unresolved |

## Cross-store atomicity decision

The existing room authorization is held in the application security store while durable authorization is held in PostgreSQL. No transaction can atomically consume both stores. Therefore the proposal must not claim atomicity across them. Before implementation, room authorization and participant identity must be copied into an authoritative PostgreSQL admission record during browser admission, or the browser admission must be redesigned to use PostgreSQL as the sole authority. Redis/application-store state may remain a cache, but it cannot be the source of release authority.

## Required RPC set before implementation

The approved migration must provide narrowly scoped functions equivalent to `create_worker_lease`, `begin_worker_release`, `complete_worker_release`, `mark_worker_reconciliation_required`, and `reconcile_expired_worker_lease`. Every function must use `SECURITY DEFINER`, a fixed `search_path`, row locks, request-local claims, key-state checks, and explicit version/state predicates. Direct table mutation remains denied.

The implementation-ready contract and acceptance mapping are maintained in [phase-12f-implementation-contract.md](C:\Users\PC\Documents\ChatGPT\voicepilot-livekit-codex\docs\phase-12f-implementation-contract.md) and [phase-12f-security-acceptance-matrix.md](C:\Users\PC\Documents\ChatGPT\voicepilot-livekit-codex\docs\phase-12f-security-acceptance-matrix.md). These documents remain review-only and do not resolve the listed approval gates.
