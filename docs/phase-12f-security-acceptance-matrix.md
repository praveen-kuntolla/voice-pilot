# Phase 12F security acceptance matrix (review-only)

| Finding | Enforceable control | Test | Residual risk | Approval owner |
|---|---|---|---|---|
| Atomic creation | `create_worker_lease` locks binding/authorization and inserts lease in one transaction | Inject lease/audit failure; assert rollback | Room authority migration | DB/security review |
| Cross-tenant binding | Server-derived joins and exact composite identity checks | Wrong org/agent/actor/session/assertion/room/participant | Correctness of binding backfill | Security reviewer |
| Worker key binding | Key registry plus lease `worker_key_id` FK/state check | Wrong, revoked, expired, rotated key | Secret manager compromise | Platform security |
| State transitions | RPC-only mutation, `FOR UPDATE`, version predicates | Concurrent/illegal transitions | Operator reconciliation | DB owner |
| Least privilege | RLS, revoked table grants, RPC-only worker role | Direct table and client-role denial | Role misconfiguration | DBA/security |
| Room/participant authority | PostgreSQL admission binding table | Room/participant substitution | Provider event quality | Architecture owner |
| HMAC/replay | Signed key ID, scoped nonce uniqueness, freshness | Altered body/path, replay, stale timestamp | Key theft | Security owner |
| Duplicate leases | Unique authorization/session/assertion plus lock | Concurrent creation | Retention policy | DB owner |
| Audit safety | Typed bounded event rows, immutable trigger | Metadata injection and event mutation | Retention/deletion | Compliance owner |
| Emergency stop | Termination evidence required before release | Provider active during stop | Provider outage | Operations owner |
| Expiry/reconciliation | Expiry only queues exact lease for evidence-based reconciliation | Crash, partition, stale provider | Reconciliation delay | SRE/security |

Disposable PostgreSQL can verify SQL locking, constraints, RLS, replay, state transitions, rollback, and idempotency. Provider termination evidence, key-manager behavior, and real worker/provider shutdown require separately approved integration testing and must remain disabled for offline acceptance.

## Approval status

| Finding | Technical contract status | Independent approval |
|---|---|---|
| Atomic creation | Specified by `create_worker_lease` lock/insert contract | NO-GO until executable RPC review |
| Cross-tenant binding | Required joins and equality predicates specified | NO-GO until disposable SQL test passes |
| Worker-key binding | Registry, validity, and lease binding specified | Pending key-management owner |
| State transitions | Required RPC-only versioned transitions specified | NO-GO until transition RPC exists |
| Least privilege | Revoke/direct-access model specified | Pending DBA/security approval |
| Room/participant authority | `voice_admission_bindings` proposed | Pending Phase 12E compatibility review |
| HMAC/replay | Key/path/nonce table and canonical contract specified | Pending worker-auth implementation review |
| Duplicate leases | Unique constraints and row-lock requirement specified | Pending concurrent SQL test |
| Audit safety | Append-only event and bounded reason contract specified | Pending immutable trigger/RPC review |
| Emergency stop | Evidence-gated release specified | Pending provider-neutral evidence owner |
| Expiry/reconciliation | Exact-lease evidence-gated reconciliation specified | Pending SRE/operator approval |

The SQL is now contract-complete for review but is not implementation-complete: RPC bodies, grants, migration sequencing, and provider evidence integration remain intentionally unimplemented.

## 12F.1L remediation status

| Finding | Correction in review-only SQL | Required regression test | Approval dependency | Status |
|---|---|---|---|---|
| Default function exposure | Executable revoke for `public`, `anon`, and `authenticated`; dedicated role remains unassigned | Direct execute denial by untrusted roles | DBA/security owner must approve the gateway role and grants | Pending |
| Revoked release key | `begin_worker_release` and `complete_worker_release` lock and validate active key validity | Revoke/expire/rotate key during release | Worker-key owner | Pending |
| Unauthenticated reconciliation | Reconciliation remains a separate administrative contract; no ordinary worker grant | Worker role cannot reconcile another lease | Operations/security owner | Pending |
| Forged provider evidence | Added fail-closed `record_provider_termination_evidence` with binding and freshness checks | Worker insert denial; producer mismatch; stale evidence | Provider evidence owner | Pending |
| Nonce misuse | Active-key validation and path allowlist added to nonce claim | Revoked key, invalid path, stale nonce | Worker-auth owner | Pending |
| Attempt collision | Existing attempt ownership is checked after conflict | Same UUID across leases/keys | DB owner | Pending |
| Timestamp skew | Release and evidence functions enforce bounded clock skew | Old/future request timestamps | Worker-auth owner | Pending |
| Expiry/reconciliation | Evidence-gated release remains required; explicit expiry transition still needs owner-approved scheduler/RPC | Crash and expired active lease | SRE/security owner | Pending |
| Room binding | Evidence and lease paths enforce room/session/participant equality; write authority remains PostgreSQL-only by design | Room substitution and cross-tenant binding | Architecture owner | Pending |
| Audit immutability | Direct untrusted table access revoked; append-only trigger still required | UPDATE/DELETE audit attempts | DBA/compliance owner | Pending |
| Contract consistency | SQL function inventory and signatures must be copied into implementation tests before runtime work | Signature compatibility check | Security reviewer | Pending |

## Control readiness states

| Control | SQL control drafted | Independent review | Role owner approved | Disposable PostgreSQL verified | Production ready |
|---|---:|---:|---:|---:|---:|
| Reconciliation authorization | Yes | No | No | No | No |
| Append-only audit trigger | Yes | No | No | No | No |
| Audit transition uniqueness | Yes | No | No | No | No |
| Provider evidence ingestion | Yes, fail-closed contract | No | No | No | No |

The reconciliation role name is a deployment prerequisite, not an approved
production identity. Superuser, table-owner, and migration-owner bypasses must
be tested or separately controlled before any production migration.

## 12F.1O update

Draft SQL corrections now cover stale/cancelled/expired/consumed binding
rejection, explicit reconciliation-role checks, and evidence-producer role
checks. These controls remain pending until independent review and disposable
PostgreSQL tests. Audit INSERT authority and privileged-owner separation remain
approval dependencies.

## 12F.1Q update

Caller authentication is now specified as a database `EXECUTE`-grant boundary
with a non-login function owner; no `current_user` check is used inside
`SECURITY DEFINER` bodies. The evidence RPC fails closed until a trusted
producer is approved. Candidate role grants and ownership are unapproved, and
the lifecycle lock order still requires implementation before disposable
verification.
