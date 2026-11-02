# Phase 24A — Full Product Readiness Audit

Status: **offline/local MVP audit; not a production approval**. No migrations, SQL, providers, LiveKit rooms, microphones, telephony, deployments, or Git synchronization were performed for this audit.

## Executive assessment

OUTLIVO is a credible tenant-scoped configuration and simulation MVP. The authenticated SaaS shell, organization boundaries, agent/contact/campaign/knowledge CRUD, governance surfaces, consent-aware readiness checks, offline rehearsal, and deterministic test tooling are implemented locally. The product is not yet a functional AI telecalling platform because all live voice, telephony, provider, campaign-dispatch, retrieval, scheduling, webhook, and durable run-execution paths remain disabled, synthetic, or review-only.

Recommended product posture: continue presenting the current product as **safe offline configuration and rehearsal**. The next development milestone should be a reviewed production foundation for one narrow capability—preferably authenticated provider-neutral campaign-run persistence and worker admission—without enabling live calls until Phase 12F and the provider/telephony gates are approved.

## Implemented feature inventory

### Fully functional approved/local SaaS features

- Public marketing, signup, login, auth callback, password recovery/reset, and onboarding flows exist.
- Onboarding updates the authenticated profile and invokes the existing organization-creation RPC.
- Server-side Supabase access is used for protected routes; browser code does not receive service-role credentials.
- Organization switching is membership-checked and cookie-scoped.
- Tenant-scoped CRUD exists for agents, contacts, campaigns, and Knowledge Base source references.
- Owner/admin write boundaries and member reads are represented in the current RLS policies and API authorization checks.
- Contact consent states, opt-out timestamps, CSV import, duplicate-aware import behavior, search, filtering, pagination, and deletion are implemented.
- Campaign draft configuration validates calling hours, agent ownership, timezone, and consent-required settings.
- Knowledge Base source validation supports bounded text, HTTP(S) URL references, and file-reference metadata. It does not ingest or retrieve content.
- Profile and provider-governance/settings surfaces exist for approvals, quotas, privacy policy, usage and audit views; these controls do not activate providers by themselves.
- Health endpoint and local isolated fixture/authentication runners exist.

### Functional local-only features

- Authenticated local Supabase fixture provisioning and disposable gateway tests.
- Organization-scoped campaign simulation preflight, including cross-tenant denial and consent revalidation.
- Session-local audience selection and offline campaign rehearsal.
- Synthetic Calls and Analytics activity stored only in the browser tab, with redacted exports.
- Local Agent Test Studio with server preflight, deterministic conversation controller, bounded turns, reset/interrupt/end states, and rule-based evaluation.
- Synthetic keyword knowledge panel with fixed in-memory documents; it does not use tenant Knowledge Base rows.
- Offline recovery/lifecycle views and deterministic Python worker/admission contracts.

### Synthetic/simulation-only features

- STT, LLM, TTS, LiveKit, voice, campaign outcomes, calls, analytics, callbacks, appointments, and provider lifecycle events are mock/deterministic.
- Offline voice/session gateways can exercise authorization and lifecycle contracts but do not create rooms, audio, recordings, calls, or provider usage.
- The Python worker contains a future LiveKit boundary and mock pipeline; default flags fail closed before external activity.
- Calls/Analytics labels are explicitly synthetic in the current UI, but the navigation names can still be mistaken for production telemetry by a new user.

### Review-only architecture

- Phase 12F worker leases, evidence-gated reconciliation, role/grant model, and SQL are not approved or executed.
- Phase 16 persistent campaign audiences/runs/events and companion SQL are proposals only; no durable campaign run authority exists.
- Phase 23A/23B Knowledge Retrieval ingestion, extraction, chunking, embeddings, assignments, vector retrieval, retention, and deletion design are review-only.
- Provider integration readiness, LiveKit connectivity/realtime activation, telephony, webhook verification, and production gateway designs remain gated.

### Missing product capabilities

- Real STT/LLM/TTS provider adapters and a provider-neutral production runtime.
- LiveKit room lifecycle with approved token/admission, microphone consent, participant termination, and production monitoring.
- Telephony provider integration, outbound dialer, inbound handling, caller-ID/compliance controls, voicemail, retries, and webhook reconciliation.
- Durable campaign audience membership, campaign run scheduling/queueing, idempotency, pause/cancel/retry, per-contact execution state, and operator controls.
- Production Knowledge Base ingestion, private object storage, extraction, chunking, embeddings, tenant-isolated retrieval, assignments, and deletion reconciliation.
- Production call records, recordings/transcripts policy and storage, retention/deletion workflows, provider usage billing, and audit evidence.
- Operational deployment, secret manager, queues/leases, observability, alerting, backups, disaster recovery, migrations/rollback, and support tooling.

## User-journey audit

| Journey step | Current evidence | Readiness classification | User-facing gap |
| --- | --- | --- | --- |
| Signup/login | Supabase browser auth, callback and protected redirects | Functional local SaaS | Email delivery, abuse controls, production auth configuration and recovery operations are not verified here |
| Onboarding | Profile PATCH plus organization creation RPC | Functional where approved baseline schema/RPC exists | Organization creation failure/retry and invitation lifecycle need production observability |
| Agent creation | Tenant-scoped CRUD, draft/active/archived states, mock voice profile | Functional local-only configuration | “Active” is configuration-only; no real runtime can consume the agent |
| Knowledge management | CRUD for bounded text/URL/file references, explicit stored-only messaging | Functional reference registry | No ingestion, indexing, retrieval, assignments, upload, or deletion cascade |
| Contact import | CSV preview/import, consent defaults to unknown, tenant CRUD | Functional local-only data management | No phone validation against carrier/DNC, consent evidence, import audit, dedupe policy beyond current contract, or suppression service |
| Campaign creation | Draft/test config, same-tenant agent checks, calling-hour validation | Functional local-only configuration | No durable audience, schedule, queue, dialer, run lifecycle, or provider dispatch |
| Audience readiness | Server preflight, session-local selection, consent/opt-out recheck | Functional offline safety gate | Browser readiness is not durable execution authorization; current campaign-contact relationship is absent |
| Offline rehearsal | Bounded deterministic simulation and reset/revalidation | Synthetic/simulation-only | No real call, appointment, callback, or business record is created |
| Analytics | Persisted tenant counts plus tab-local synthetic activity | Mixed local-only/synthetic | Calls and outcomes are not production events, revenue, conversion, recordings, or billing telemetry |
| Settings | Profile, provider approvals, quotas, privacy and audit surfaces | Functional governance UI/local persistence | Approval records do not provision secrets, activate providers, or prove production enforcement |

## Critical misleading-state and UX risks

1. **Calls/Analytics naming:** users may infer that synthetic activity is production call telemetry. Existing copy mitigates this, but a production-ready product should separate “Simulation Reports” from “Calls” and require an explicit mode banner.
2. **Agent active status:** “Active (configuration only)” is accurate but still visually close to deployable state. A future deploy/readiness state should be separate from configuration status.
3. **Knowledge `ready` status:** current Phase 23A/23B UI now explains that this is a stored reference, not indexed/retrievable. The database value remains semantically overloaded and should be split before ingestion.
4. **Consent:** a user can set “granted” locally; this is not proof of lawful consent, DNC screening, jurisdictional calling-hour compliance, or a consent artifact.
5. **Provider governance:** settings can display or persist approval/quota policy, but approval is not activation and must not be presented as provider connectivity.
6. **Campaign rehearsal:** readiness and simulation success do not prove a future carrier, provider, worker, recording, webhook, billing, or termination path.

## Route/API and infrastructure inventory

### Application routes

Public/auth: `/`, `/features`, `/pricing`, `/contact`, `/signup`, `/login`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/onboarding`, `/invite/accept`.

Authenticated workspace: `/dashboard`, `/dashboard/agents`, `/dashboard/agents/test`, `/dashboard/knowledge`, `/dashboard/contacts`, `/dashboard/campaigns`, `/dashboard/campaigns/review`, `/dashboard/calls`, `/dashboard/analytics`, `/dashboard/recovery`, `/settings`.

Developer-only surface: `/developer-preview`.

### API families

- Identity/workspace: profile, organization switch, invitations and invitation acceptance, health.
- Configuration: agents, agent simulation preflight, contacts, campaigns, campaign simulation preflight, Knowledge Base references.
- Governance: organization/agent provider approvals, revocation, privacy policy, quotas, usage, audit.
- Offline voice: `/api/voice-session/offline`.
- LiveKit boundaries: browser session, token, session termination, internal worker config. These are guarded and/or disabled in the current environment.
- Contact form: public contact submission.

### Current schema families

The approved baseline includes profiles, organizations, organization members, invitations, audit logs, contact submissions, agents, knowledge sources, contacts, campaigns, and provider-governance/accounting tables. Later review-only designs describe worker leases/reconciliation and persistent campaign audience/run/event tables, but those proposed objects are not production-authorized by this audit.

### Worker/background boundaries

The repository contains a future LiveKit Agents worker, mock conversation/provider pipeline, signed/offline admission, disposable voice gateway, fixture provisioning, and isolated browser runners. No production scheduler, dialer queue, ingestion worker, retrieval worker, webhook consumer, or durable campaign executor is active.

## Security and production blockers

### Highest impact blockers

- **Phase 12F:** human approval, role ownership, grants, evidence producer, audit retention, reconciliation semantics, disposable SQL execution, and PostgreSQL authority cutover remain pending/no-go in the existing handoffs.
- **Phase 16:** persistent campaign audience/run SQL is review-only; critical tenant-key/RLS/RPC/grant, concurrency, idempotency, event, retention, and provider-authority decisions remain pending.
- **Knowledge Retrieval:** no approved content/revision/job/chunk/embedding/assignment schema, object storage, parser sandbox, worker identity, vector index, provider/data-region policy, or deletion contract.
- **Voice providers/telephony:** no approved provider accounts, secrets, capability adapters, LiveKit production project, carrier compliance, consent/DNC service, webhook signatures, cost limits, or termination evidence.
- **Operations:** no production deployment/rollback/SLO/monitoring evidence, disaster recovery, secret rotation, or incident process is established by the local tests.

### Security dependencies for real calling

1. Authenticated server admission bound to actor, organization, agent, campaign, contact and consent state.
2. Durable replay/idempotency, quota, concurrency, spend, emergency-stop and lease controls.
3. Provider-specific credentials in a secret manager; never browser-visible.
4. Short-lived room/token binding, participant termination, microphone consent and stale-session handling.
5. Carrier/calling-hour/DNC/opt-out enforcement and jurisdictional consent evidence.
6. Signed provider webhooks, replay protection, event reconciliation and append-only sanitized audit evidence.
7. Recording/transcript redaction, retention, deletion, regional processing and access controls.
8. Operational alerts for failed termination, orphaned leases, spend anomalies, queue lag, provider errors and deletion lag.

## Prioritized roadmap

| Priority | Milestone | Product impact | Security dependency | Complexity | Acceptance criteria |
| --- | --- | ---: | ---: | ---: | --- |
| P0 | Approve and verify production authority foundation | Very high | Critical | High | Independent approvals for Phase 12F/16 contracts; disposable PostgreSQL/RLS/RPC/grant/concurrency tests pass; rollback and ownership recorded |
| P0 | Durable campaign audience/run foundation, simulation-only | Very high | Critical | High | Tenant-safe audience/run/event persistence; idempotent create/transition; stale consent blocks; pause/cancel/retry; no provider dispatch |
| P0 | Production voice/provider threat model and one-provider plan | Very high | Critical | High | Provider, region, consent, retention, secret, cost, termination and webhook approvals recorded; test account/runbook exists |
| P1 | Trusted worker/LiveKit connectivity and admission | High | Critical | High | Short-lived bound sessions, signed worker requests, replay/lease controls, termination evidence, no microphone/provider activation until approved |
| P1 | Telephony compliance and carrier adapter | Very high | Critical | Very high | DNC/opt-out/calling-hours/consent enforcement, carrier webhooks, idempotent call state, spend/kill switch, redacted audit |
| P1 | Knowledge Retrieval production foundation | High | High | High | Reviewed revisions/jobs/chunks/embeddings/assignments/RLS; SSRF/file sandbox; bounded retrieval; deletion/reconciliation; offline contract tests |
| P2 | Operational productionization | High | High | Medium/high | Secret rotation, deployment/rollback, backups, SLOs, alerts, cost dashboards, incident/runbooks, support access reviews |
| P2 | UX mode separation and lifecycle polish | Medium | Medium | Medium | Clearly separate simulation vs production screens, deployment readiness, provider status, consent evidence and run controls |
| P3 | Quality/optimization | Medium | Medium | High | Retrieval evaluation, prompt/voice quality, retry tuning, carrier analytics, multi-provider fallback only after policy approval |

## Suggested next development milestone

**Phase 24B: Durable simulation campaign-run foundation, approval-gated.** Implement only after explicit approval of the Phase 16 review-only schema and Phase 12F dependency boundary. Keep run kind strictly `simulation`; persist tenant-scoped audience/run/event state, idempotency fingerprints, versioned transitions, stale-consent blocking, bounded retry/cancel semantics, and redacted audit evidence. Do not dispatch a provider, allocate a LiveKit room, contact a customer, or execute the review-only SQL without written authorization.

This milestone delivers the most valuable product progression—repeatable campaign operations and operator visibility—while preserving the current offline safety posture and avoiding duplicate provider/retrieval implementations.

## Verification evidence

### Executed during this audit

- TypeScript: passed (`tsc --noEmit`).
- ESLint: passed (`eslint .`).
- Full Vitest: **339 passed, 21 skipped** across 69 files.
- Python worker tests: **74 passed**.
- `git diff --check`: passed; only existing line-ending warnings were reported.
- Port 3402 health: HTTP **200**, `databaseConfigured: true`.

### Previously reported evidence, not rerun for this audit

- Authenticated campaign-readiness: 3 passed.
- Authenticated full Contacts → Campaigns → Offline Rehearsal: 1 passed after the Phase 22B.5 fix.
- Authenticated Knowledge Base suite: 2 passed.
- Authenticated Agent Test Studio suite: 4 passed after the Phase 23C test correction.
- Isolated production builds with loopback placeholder Supabase configuration: passed in prior phases.

These browser results remain local disposable-fixture evidence, not proof of production provider, carrier, LiveKit, retrieval, or deployment readiness.

## Files changed

- `docs/phase-24a-full-product-readiness-audit.md` — this review-only audit.

No application source, migrations, SQL, providers, deployments, or external systems were changed.
