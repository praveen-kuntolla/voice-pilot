# Phase 16A — Persistent Campaign Audience and Run Architecture

Status: review-only proposal. No objects in this document or the companion SQL are applied.

## Current boundary

`campaigns` and `contacts` are organization-scoped. Campaign writes are owner/admin-only through the server routes; members can read through tenant-scoped RLS. `contacts.consent_status` is `unknown`, `granted`, or `revoked`, and `opted_out_at` is a separate durable exclusion. The current simulation preflight evaluates the organization contact pool and deliberately does not persist an audience or a run. Phase 12F worker-lease SQL remains review-only and is not a dependency that may be activated by this proposal.

## Proposed relationships

The review-only SQL proposes:

- `campaign_audiences`: one named, tenant-owned audience per campaign/version, with creator, lifecycle state, and timestamps.
- `campaign_audience_contacts`: one row per `(audience_id, contact_id)`, carrying the assignment actor and assignment/removal timestamps. A partial uniqueness rule prevents duplicate active assignments without erasing audit history.
- `campaign_runs`: a durable preparation or simulation run linked to exactly one campaign and audience snapshot, with `kind` (`simulation` initially), explicit state, idempotency key, actor, snapshot time, and bounded retention metadata.
- `campaign_run_events`: append-only, bounded, redacted lifecycle events. It contains no phone number, transcript, audio, provider credential, or raw provider payload.

Tenant identity is proposed as part of every parent key: audience-to-campaign, assignment-to-audience/contact, run-to-campaign/audience, and event-to-run. The implementation must use composite unique keys and foreign keys, not merely repeated organization columns.

Saved audience membership is configuration only; it is never consent, authorization, a reservation, or permission to call. Consent and opt-out are rechecked from authoritative contact rows at every preflight/run transition.

## Transaction and concurrency contract

Audience add/remove operations lock the campaign and contact rows in deterministic `(organization_id, id)` order, verify membership and role, then insert/update the assignment and audit event in one transaction. A run creation transaction locks the campaign, audience, assigned agent, and selected contacts in that order, verifies all rows belong to the same organization, rejects archived agents, and writes a snapshot hash. A unique `(organization_id, idempotency_key)` constraint returns the existing run for a safe retry only when the request fingerprint matches.

The execution transition revalidates current consent, `opted_out_at`, agent status, campaign state, and organization membership. Any mismatch moves the run to `blocked`/`stale`; it never silently refreshes eligibility or dispatches work. No provider reservation, worker lease, LiveKit room, telephony action, or Phase 12F release is created by this phase.

Run transitions are proposed as a database-enforced matrix: `draft → queued|blocked|cancelled`, `queued → running|blocked|cancelled`, and `running → completed|failed|cancelled|blocked`; terminal states cannot transition. An expected-version predicate and checked update count prevent stale writers. An idempotency retry must compare the original fingerprint and all tenant-scoped parent IDs, returning conflict on mismatch.

## RLS and API contract

All proposed tables have RLS enabled. Member reads require `public.is_org_member(organization_id)`; audience/run mutations require an owner/admin check equivalent to `public.is_org_admin`. Browser APIs derive organization from `currentMembership()` and accept only campaign/contact IDs, never an organization ID as authority. The server must return redacted contact summaries and counts, not phone numbers.

The review-only SQL now drafts member SELECT policies and intentionally omits client mutation policies. Deployment must apply explicit revokes and grant only approved trusted RPCs; role names and function ownership remain human approval items.

The companion contract now contains candidate RPC bodies for assigning contacts, creating simulation runs, guarded state transitions, and redacted event insertion. These are complete design candidates but remain unexecuted and require PostgreSQL syntax, privilege, RLS, locking, and concurrency verification. Provider-backed run creation remains absent.

Suggested endpoints, all provider-disabled initially:

- `GET/POST /api/campaigns/:id/audience`
- `DELETE /api/campaigns/:id/audience/:contactId`
- `POST /api/campaigns/:id/runs` with `kind=simulation`
- `GET /api/campaign-runs/:id`
- `POST /api/campaign-runs/:id/cancel`

POST requests require a bounded request body, an idempotency key, and a server-side revalidation transaction. A future provider-backed run needs a separate security review and must not reuse the simulation endpoint by changing a client field.

## Consent, retention, and rollback

Consent changes immediately invalidate eligibility; assignment rows may remain for audit but are excluded from every execution snapshot. Deleting a contact removes or tombstones assignments according to the approved retention policy. Runs retain redacted events for a bounded period, then are purged by an approved owner. Rollback disables new audience/run APIs and preserves existing rows and audit evidence; it does not delete active evidence or release capacity.

The proposed snapshot transaction locks campaign, audience revision, agent, and selected contacts in deterministic order, rechecks consent and opt-out state, and records a snapshot hash. A concurrent consent update causes the snapshot to block or retry; it never grants eligibility from stale browser state. Audience revisions are immutable once referenced by a run.

## Required approvals and blockers

Human approval is required for schema ownership, RLS policy review, retention period, audit ownership, idempotency semantics, and any future provider-run authority. Disposable PostgreSQL verification must prove cross-tenant denial, role enforcement, duplicate assignment prevention, stale-consent blocking, concurrent run creation, retry idempotency, cancellation, event bounds, and cleanup. Until those approvals and tests exist, the only permitted run kind is offline simulation.
