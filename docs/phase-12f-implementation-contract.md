# Phase 12F implementation contract (review-only)

Status: specification only. No endpoint, migration, worker transport, provider, or LiveKit activation is authorized.

## Proposed sole authority

PostgreSQL becomes authoritative for the admission record, room/participant binding, durable authorization, worker lease, and release state. The existing application security store may retain a cache for room lookup, but cache state cannot authorize a worker, create a lease, or release capacity.

The Phase 12E compatibility plan is additive:

1. Add the PostgreSQL admission/room-binding records and RPCs in a disabled migration.
2. Keep the current browser route and Phase 12E disposable route unchanged while a feature flag remains off.
3. In a disposable acceptance database, run a compatibility verifier comparing the PostgreSQL binding to the existing room authorization before enabling the new path.
4. Switch the route atomically to the PostgreSQL RPC; do not dual-write two authorities.
5. Retain the old store read-only for bounded rollback observation, then remove it from authorization decisions.
6. Rollback disables new lease creation and preserves active lease/reservation evidence; it never deletes active rows.

## Authoritative records

`voice_admission_bindings` contains one immutable browser admission binding: organization, agent, actor, session, assertion, room, participant, authorization ID, status, and expiry. `worker_session_leases` references it and binds the authenticated worker key. All identity columns are server-derived by RPC; clients and workers submit only an admission/lease identifier and signed operation metadata.

## RPC contracts

All functions are `SECURITY DEFINER`, use `set search_path = pg_catalog, public, auth, voicepilot_safety`, set a statement timeout at the gateway, lock target rows with `FOR UPDATE`, set request-local organization/actor claims, and expose no direct table grants.

### `create_worker_lease`

```text
create_worker_lease(p_authorization_id uuid, p_worker_key_id text,
                    p_now timestamptz, p_expires_at timestamptz)
returns jsonb
```

Transaction: lock the admission binding and authorization; require matching organization/agent/actor/session/assertion/room/participant, consumed authorization, active/nonexpired state, active worker key, and no emergency stop. Insert exactly one lease. Insert a `created` audit event. If lease insertion or audit insertion fails, the whole transaction rolls back and authorization consumption remains unchanged.

### `begin_worker_release`

```text
begin_worker_release(p_lease_id uuid, p_worker_key_id text,
                     p_release_attempt_id uuid, p_now timestamptz)
returns jsonb
```

Lock the lease. Verify key-to-lease binding, active/releasing state, version, and termination evidence state. Transition `active → releasing`, increment version, and insert one append-only event keyed by attempt ID. Repeated attempts return the existing state without freeing capacity.

### `complete_worker_release`

```text
complete_worker_release(p_lease_id uuid, p_worker_key_id text,
                        p_release_attempt_id uuid, p_evidence_id uuid,
                        p_now timestamptz)
returns jsonb
```

Lock the lease and evidence. Require server/provider-confirmed termination, matching key and attempt, and `releasing` state. Call the existing tenant-bound authorization release operation in the same transaction, then transition to `released` and append exactly one event. Already released leases return idempotent success.

### `mark_worker_reconciliation_required`

```text
mark_worker_reconciliation_required(p_lease_id uuid, p_reason text,
                                    p_now timestamptz)
returns boolean
```

Locks the exact lease and transitions only `active` or `releasing` to `reconciliation_required`. It never releases capacity.

### `reconcile_expired_worker_lease`

```text
reconcile_expired_worker_lease(p_lease_id uuid, p_evidence_id uuid,
                               p_now timestamptz)
returns jsonb
```

Locks the exact expired lease. Expiry is only eligibility for reconciliation, not termination proof. It releases capacity only when the evidence record is server/provider-confirmed and matches the room/session/participant; otherwise it remains `reconciliation_required`.

## Worker-key contract

The signed request includes `key_id` in the canonical body and headers:

```text
METHOD\nPATH\nTIMESTAMP_MS\nNONCE\nKEY_ID\nEXACT_COMPACT_BODY
```

The server resolves the secret by key ID from a secret manager, never from the request. The key registry stores worker identity, scope, active/revoked/expired status, validity interval, and secret reference. Nonces are atomically unique on `(key_id, path, nonce)` with a five-minute freshness window. Rotation permits old and new keys to overlap; revoked keys cannot create or release leases, including existing leases, unless an independently approved emergency recovery procedure exists.

## Termination evidence

- Worker-reported completion: advisory only; cannot release capacity.
- Server-confirmed termination: trusted control-plane observation that the authorized session was stopped.
- Provider-confirmed termination: authoritative provider event or verified API response bound to room and participant.
- Unconfirmed/unreachable: retain capacity and set `reconciliation_required`.

Provider-neutral evidence must include evidence ID, source, room, participant, session, observed time, terminal state, and immutable digest. Lease expiry and worker claims alone never satisfy completion.

## Migration and rollback

Proposed ordering is: admission binding, worker keys, lease table, audit/evidence tables, RPCs/grants, then disabled application wiring. Backfill is not permitted for active sessions without authoritative room/participant evidence. Rollback disables new RPC calls, preserves active/releasing/reconciliation rows, and leaves audit evidence intact. Destructive table removal is not a rollback option. Retention and deletion require an approved audit policy.

## Approval gates

Independent approval remains required for the secret manager, worker-key owner, provider termination evidence source, least-privileged database role, audit retention, compatibility cutover, and reconciliation SLO.

## Phase 12F.1L hardening status

The review-only SQL now includes executable deny-by-default revokes for the
untrusted roles, active/valid worker-key checks during nonce claims and release
transitions, bounded operation timestamps, release-attempt collision detection,
and a fail-closed `record_provider_termination_evidence` contract. The SQL does
not create or assume a production worker role, grant direct table access, or
approve an evidence producer. Those ownership decisions remain explicit
approval blockers.

The audit table still requires an approved append-only trigger or equivalent
owner-controlled write path before deployment. Reconciliation requires a
separate trusted operator/server role and must not be exposed through the
ordinary worker-release role. The room-binding write path and PostgreSQL
cutover from the Phase 12E store also remain disabled until disposable
transaction/RLS tests pass.

## Administrative reconciliation and audit controls

The review-only SQL now proposes `voice_reconciliation_operator` as a named
deployment role, but does not create it or assign ownership. The reconciliation
RPC rejects calls unless `current_user` is that role, locks the lease and
authorization rows, derives tenant/session identity from those rows, and
requires evidence before releasing capacity. The DBA/security owner must
provision the role and grant only the reconciliation RPC.

Audit events have a unique `(lease_id, event_type, version)` key and a
`BEFORE UPDATE OR DELETE` append-only trigger. Direct writes remain revoked
for untrusted roles. PostgreSQL superusers, the table owner, and migration
owners can bypass ordinary RLS/trigger assumptions; production ownership and
superuser separation therefore require explicit DBA approval.

The lease-creation contract also requires an `authorized`, unexpired binding,
an unconsumed authorization, and a future lease expiry. Both reconciliation
functions perform an explicit operator-role check, while evidence ingestion
requires an approved server/provider ingestor role. These role names remain
unprovisioned review placeholders.

## Candidate caller-authentication model

`SECURITY DEFINER` bodies do not authenticate callers with `current_user`.
The proposed boundary is a non-login, non-superuser function owner plus
explicit `EXECUTE` grants to separate gateway, reconciliation, and evidence
ingestor roles. The review-only SQL creates none of these roles and grants
none of them; role inheritance, pooler behavior, and connection role
switching require DBA verification.

Evidence ingestion currently fails closed with
`termination_evidence_producer_unconfigured`. It must remain disabled until a
server/provider adapter verifies signed or provider-authenticated terminal
events and receives the separately approved evidence-ingestor grant.

The feasible lock contract is family-specific: admission creation locks
authorization, binding, key, lease insert, and audit; worker release locks
lease, evidence, authorization, key, attempt, and audit; begin-release locks
lease, key, attempt, and audit; reconciliation marking locks lease then audit;
evidence ingestion locks lease then inserts evidence; nonce claim validates key
then inserts the nonce. This exception exists because release and evidence
must discover and bind through the lease. It requires concurrent cross-family
testing and is not a claim of deadlock freedom.
