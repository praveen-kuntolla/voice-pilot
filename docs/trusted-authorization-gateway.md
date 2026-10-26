# Trusted authorization gateway

Status: **offline contract-tested; not production-ready and not connected to a live provider**.

## Trust boundaries

The browser is untrusted. Organization IDs, actor IDs, roles, cookies, room names and provider metadata supplied by a client are selectors only and never proof of authority. `authorizeCurrentServerActor()` verifies the user with Supabase Auth on the server, then queries `organization_members` for that verified user and requested organization. The `voicepilot_org` HttpOnly cookie may select a workspace, but the authoritative membership query must still succeed.

The role matrix is explicit: viewers can read, members can read and run local simulation, and owners/admins may manage safety configuration or request a privileged offline operation. Missing, expired, revoked or malformed sessions; absent memberships; query failures; spoofed actor IDs; and unsupported roles all fail closed with typed denial reasons.

## Privileged SQL isolation

`executePrivilegedSafetyOperation()` exposes only narrow operations. It accepts no SQL from its caller and uses the parameterized `PostgresDurableSafetyStore`. A separately supplied transaction executor must open a dedicated transaction. Inside that transaction the gateway binds the independently verified actor and organization using transaction-local `set_config(..., true)`. Commit, rollback and connection reuse clear that context; disposable PostgreSQL tests verify both paths.

`request.jwt.claim.sub` is context, not identity proof. A privileged PostgreSQL connection can set it. The application gateway must authenticate the actor and derive membership before setting it. Service-role credentials remain server-only and this change does not create or activate a production database credential or public privileged endpoint.

## Consolidated policy enforcement

The offline policy gateway obtains campaign, agent, contact, limits and calling-hours data from an authoritative repository. It verifies tenant ownership, campaign-agent linkage, agent availability, explicit granted consent, revocation and opt-out state, a trusted server clock and timezone, global and organization stops, concurrency/retry/spend ceilings, rate limits and tenant/provider-bound idempotency. Missing controls or database state return `unavailable`; permission failures return `denied`; active safety policy returns `safety_blocked`.

Any future active operation requires a fresh check immediately before execution. Rate, concurrency and spend reservations must be transaction-safe, emergency stops must be ordered ahead of new work, and the provider action and reservation must have a reviewed reconciliation strategy. These offline contracts do not create calls, messages, appointments, billing events or provider jobs.

## Failure behavior

- Authentication and membership errors deny access.
- Database, policy-repository or control-state failures deny execution as unavailable.
- Missing global or organization stop rows fail closed.
- Duplicate idempotency claims and exhausted limits are safety-blocked.
- Transaction failures roll back and return unavailable without retaining request context.
- No in-memory authorization fallback is used when authoritative state is unavailable.

## Verification and known limitations

Unit tests cover anonymous, expired/revoked sessions, removed membership, cross-tenant selection, role escalation, spoofed actors, stops, consent, schedules, limits, duplicate claims, concurrent claims and database failure. A disposable database applies review-only migrations 012–013, verifies context cleanup across commit/rollback and is dropped afterward. Static browser-boundary tests confirm no public API route imports the privileged executor.

This is not production authorization evidence by itself. Production still requires independent security review, durable distributed rate/idempotency storage, audited secret rotation, production-grade pooling tests, immutable audit export, monitoring and incident response, legal/compliance approval, backup/restore rehearsal and provider-specific webhook verification. Migrations 012–013 remain review-only and the established local ledger remains 001–011.

## Future provider-activation gates

Before any isolated connectivity test: use a separate provider project and synthetic tenant, retain outbound calling disabled, validate emergency-stop operators, cap concurrency and spend, verify consent/calling hours, rehearse cleanup and credential revocation, monitor every reservation/event, and obtain explicit user approval. No such connectivity test is authorized by this phase.
