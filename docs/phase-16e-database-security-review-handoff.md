# Phase 16E — Database Security Review Handoff

Status: prepared for independent human review. No SQL has been executed or applied.

## Scope

This handoff covers the review-only persistent campaign audience and simulation-run proposal in `docs/review-only/20261102_phase16_campaign_audience_runs.sql`. It does not approve persistent execution, provider-backed runs, Phase 12F worker leases, LiveKit, telephony, or any production migration.

## Proposed schema and relationships

- `campaign_audiences` belongs to one organization and campaign.
- `campaign_audience_contacts` records tenant-scoped assignments and removals. A partial unique index permits one active assignment per audience/contact.
- `campaign_audience_revisions` records immutable audience snapshots and hashes.
- `campaign_runs` belongs to one tenant, campaign, audience, and immutable request fingerprint. The only permitted kind is `simulation`.
- `campaign_run_events` is intended to be bounded, redacted, sequenced, and append-only.

Tenant identity is proposed in composite keys and foreign keys, not inferred from browser fields. Saved audience membership is not consent and never authorizes calling.

## Candidate RPC trust boundaries

1. `assign_campaign_contact(audience_id, contact_id, expected_revision)` — authenticated owner/admin only; derives organization from the locked audience, locks the contact, verifies tenant identity and revision, and rejects duplicate active assignments.
2. `create_campaign_simulation_run(campaign_id, audience_id, idempotency_key, request_fingerprint, expires_at)` — authenticated owner/admin only; locks campaign/audience/contacts, rechecks consent and opt-out, and returns an existing row only for an exact retry.
3. `transition_campaign_simulation_run(run_id, expected_version, next_state)` — authenticated owner/admin only; enforces the allowed state graph and checked optimistic version update. It must not be callable by workers or browsers through direct table access.
4. `append_campaign_run_event(run_id, sequence_no, event_type, redacted_metadata)` — trusted transition writer only; derives organization from the locked run and rejects sensitive metadata. Direct client inserts are prohibited.

These are candidate contracts, not verified runtime boundaries. The transition function and audit writer require independent review for terminal-event coupling and privileged-owner bypass.

## RLS, grants, and ownership proposal

- Members may read only rows where `public.is_org_member(organization_id)` is true.
- Owner/admin mutation occurs through approved RPCs, not direct table DML.
- `anon`, `authenticated`, browser workers, and ordinary service clients receive no direct INSERT/UPDATE/DELETE on the proposed tables.
- A dedicated function-owner role owns `SECURITY DEFINER` functions with fixed `search_path`; a separately approved API executor receives only the four required `EXECUTE` privileges.
- Reconciliation, provider evidence, Phase 12F lease functions, and administrative purge functions are outside this role.
- Exact role names, ownership, inheritance, pooler behavior, and grants require human approval; none are invented here.

## Consent and concurrency

Run creation locks the campaign, audience revision, assigned agent, and selected contacts in deterministic order. It rechecks `consent_status = 'granted'`, `opted_out_at IS NULL`, organization identity, and agent availability. A concurrent consent change causes the operation to fail or become blocked; browser snapshots are never authorization evidence.

Audience writes use an expected revision. Run transitions use an expected version and checked update count. Required PostgreSQL isolation and retry behavior must be confirmed during disposable testing.

## Idempotency

`(organization_id, idempotency_key)` is unique. A retry must match the original organization, campaign, audience, run kind, request fingerprint, and permitted actor scope. Same key with a different fingerprint is a conflict, not a new run and not an update. Concurrent requests must converge to one row.

## Audit integrity

Events must be inserted only by trusted transition functions, have bounded sequence numbers and allowlisted metadata, and reject UPDATE/DELETE. Table ownership, triggers, RLS, direct grants, migration-owner access, and superuser limitations must be tested and documented. No event may contain phone numbers, transcripts, audio, credentials, or raw provider payloads.

## Retention, deletion, and rollback decisions

Pending human decisions:

- Retention period for assignments, revisions, runs, and events.
- Whether contact deletion tombstones or removes historical assignments.
- Whether organization deletion may cascade-delete audit evidence.
- Authorized purge owner and approval process.
- Audience revision retention after a run expires.

Rollback must disable new APIs and run creation without deleting evidence or releasing any provider capacity. Provider-backed run kinds remain unavailable until a separate security review.

## Existing-schema prerequisites

Before applying the proposal, the database owner must verify or add approved, additive unique constraints required by composite foreign keys:

- `campaigns (organization_id, id)`
- `contacts (organization_id, id)`
- Any existing agent/campaign organization key needed for assigned-agent verification.

The owner must confirm existing RLS policies, indexes, delete behavior, and migration ordering. No prerequisite has been applied by Codex.

## Finding checklist

| Finding/control | Drafted | Unverified | Human decision | Required test |
|---|---:|---:|---:|---|
| Composite tenant FKs | Yes | Yes | Constraint/migration owner | Cross-tenant insert rejection |
| RLS member reads | Yes | Yes | Database security owner | Member/viewer/tenant matrix |
| RPC-only mutation | Yes | Yes | Role owner | Direct DML and grant tests |
| Consent locking | Yes | Yes | Data/security owner | Concurrent revocation |
| Audience revision CAS | Yes | Yes | Architecture owner | Stale revision rejection |
| Idempotency fingerprint | Yes | Yes | API owner | Same/conflicting concurrent keys |
| State transition graph | Yes | Yes | Security owner | Terminal and stale-version attempts |
| Append-only audit | Partial | Yes | Audit/compliance owner | UPDATE/DELETE/direct insert denial |
| Simulation-only run kind | Yes | Yes | Release owner | Provider/lease non-activation |
| Retention/deletion | Partial | Yes | Compliance/data owner | Purge and rollback behavior |

## Disposable PostgreSQL acceptance matrix

Use only a randomized loopback database with synthetic tenants, users, agents, campaigns, contacts, and approved disposable roles.

1. Owner/admin can invoke approved RPCs; member/viewer cannot mutate.
2. Members read only their tenant; cross-tenant IDs return denial or no rows.
3. Cross-tenant composite-FK injections fail.
4. Duplicate audience assignment is rejected under concurrent requests.
5. Concurrent audience mutation respects revision/version checks.
6. Consent revocation or opt-out during preflight prevents run creation/transition.
7. Same idempotency key and fingerprint converges to one run.
8. Same idempotency key with a different fingerprint returns conflict.
9. Invalid, stale, terminal, and forged run transitions fail.
10. Direct forged terminal events fail; event sequence and metadata bounds hold.
11. Unauthorized event UPDATE/DELETE/INSERT fails, including ordinary service roles.
12. Function grants, ownership, inheritance, and SECURITY DEFINER search paths match approval.
13. Simulation runs cannot reserve provider capacity, create leases, rooms, or dispatch workers.
14. Rollback disables new behavior and cleanup removes only test-owned resources.

## Explicit approval record — intentionally blank

| Field | Human reviewer entry |
|---|---|
| Reviewer identity and role | |
| Decision (GO / NO-GO / conditional) | |
| Date/time | |
| Approved scope | |
| Evidence reviewed | |
| Unresolved findings accepted | |
| Expiry/review date | |
| Signature or change-control reference | |

Codex does not complete or sign this record.

## Authorization required to proceed

Proceeding to disposable verification requires explicit human approval of the schema prerequisites, RLS/grants, function ownership, audit controls, retention behavior, feature-flag rollback, and test scope. Production migration, provider-backed runs, Phase 12F activation, and live calling require separate approvals.
