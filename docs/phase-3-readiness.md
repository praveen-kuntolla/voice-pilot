# Phase 3 integration readiness

## Local mock workflow

The safe workflow is: authenticated user -> server-selected organization -> organization-scoped agent -> signed internal configuration request -> validated runtime config -> local mock conversation -> transcript -> clean end. The mock console never calls LiveKit or an AI provider.

## Production checklist

- [ ] Apply and verify migrations 005 and 006 after approved read-only preflight.
- [ ] Verify RLS for every Agents, Contacts, Campaigns and worker configuration query.
- [ ] Configure distributed atomic nonce replay protection with TTL.
- [ ] Configure distributed rate limiting for token and worker configuration endpoints.
- [ ] Enable `VOICE_WORKER_ENABLED` only in a private worker network.
- [ ] Verify LiveKit connectivity in an isolated project before enabling realtime.
- [ ] Configure STT, LLM and TTS credentials only in worker secrets.
- [ ] Deploy the worker with short-lived credentials and rotation procedures.
- [ ] Add structured, sanitized observability for auth failures, tenant mismatches and session lifecycle.
- [ ] Run two-organization tenant isolation tests against an isolated database.
- [ ] Keep `VOICE_OUTBOUND_ENABLED=false` until telephony review and consent controls are complete.

## Migration blockers

Migration 005 adds/reconciles campaign and contact fields, RLS policies and same-organization campaign-agent enforcement. Migration 006 adds `contacts.deleted_at`. Until approved and applied, soft deletion is not active and runtime behavior must continue using the current schema. Remote migration history and live RLS remain unverified.

## Local verification results

Python worker tests and Next.js unit/security tests run against local deterministic fixtures. Public Playwright tests verify protected redirects and that the LiveKit token endpoint rejects unauthenticated requests. The later local fixture run enabled authenticated organization switching, two-tenant isolation and mock-console microphone tests; the disposable fixtures were removed afterward. No production account is used or created by the test suite.

## Phase 3.8 environment result

The local-only environment was initialized with Docker Engine 29.9.1 and Supabase CLI 2.121.0. Migrations 001–006 applied successfully to the isolated local database. Disposable two-organization Auth fixtures were created and removed after use. Actual PostgreSQL RLS tests passed for valid memberships, agent/contact/campaign tenant isolation and unauthorized cross-organization writes. Authenticated Playwright passed 8/8 local tests covering login, protected routes, organization switching, tenant-scoped agent visibility, mock voice lifecycle, microphone denial and CSV preview. No remote project, production account, LiveKit session, provider, call or email was used.

## Phase 3.9 readiness assessment

The installed client versions are `livekit-client` 2.23.0 and
`livekit-server-sdk` 2.19.1. The worker uses the compatible `livekit-agents`
1.x line and was installed locally as 1.8.8. LiveKit's current Python lifecycle
uses `AgentServer`, `@server.rtc_session()`, `AgentSession.start()` and
`Agent`; this is the shape used by the guarded worker entrypoint. See the
[LiveKit session lifecycle documentation](https://docs.livekit.io/agents/logic/sessions/)
and [Python job lifecycle documentation](https://docs.livekit.io/agents/server/job/).

The worker now has a separate `run_worker.py` launcher, strict room parsing, an
HMAC-backed configuration client, tenant-bound response validation and a
dependency-injected LiveKit server boundary. It fails closed unless worker and
realtime flags, LiveKit credentials, provider configuration and the private
configuration endpoint are present. `VOICE_PROVIDER_MODE=mock` remains the
default and cannot start a LiveKit worker; deterministic mock mode is the only
executable voice path in local development.

The browser console now owns the room lifecycle: it registers disconnect
handling, disconnects on stop and unmount, clears stale room state after an
error, and preserves the mock transcript flow. The token endpoint checks the
authenticated membership and the agent's organization, scopes the room as
`voicepilot:<organization>:<agent>` (the then-current format), and uses a five-minute token. No real room,
microphone stream, provider request or LiveKit connection was created during
this verification.

### Phase 3.9 remaining blockers

- Real STT, LLM and TTS adapters still require an explicit provider choice and
  worker-only credentials; no provider SDK is activated by this change.
- Production requires distributed nonce replay protection and rate limiting for
  the worker boundary and LiveKit token endpoint, plus private worker networking,
  secret rotation and sanitized observability.
- A future test needs a separate isolated LiveKit project and explicit approval
  to set `VOICE_WORKER_ENABLED=true`, `VOICE_REALTIME_ENABLED=true` and real
  provider mode. Outbound calling remains disabled.
- Remote Supabase migrations 005 and 006, remote RLS and remote migration
  history remain outside this local verification.

### Approved future isolated voice test

Create a separate LiveKit project, configure only its server URL/key/secret in
server and worker environments, set `VOICE_CONFIG_ENDPOINT` to the private
configuration route, and provide a rotated `VOICE_WORKER_SHARED_SECRET`. Use
one disposable test organization and agent, enable the realtime flags only for
that process, verify one browser session and transcript, then immediately
disable the flags and revoke test credentials. Do not use production data or
enable `VOICE_OUTBOUND_ENABLED`.

## Phase 3.10A isolated connectivity preparation

An opt-in connectivity-only mode is now prepared. The server validates that
the browser and worker use the same secure LiveKit origin and the declared
isolated project host. Local Supabase is required. The browser token is limited
to one room for five minutes, with audio/data publication and telephony grants
absent. The Python worker can join without AI providers and checks the
organization-scoped agent configuration before connecting. The worker
configuration route now uses a server-only database client because a worker
request does not carry an end-user cookie. The route remains behind HMAC
authentication and exact organization-plus-agent lookup.

All connectivity, realtime, worker and outbound flags remain off in the
checked-in examples. The private template and manual checklist are in
[docs/livekit-connectivity-test.md](livekit-connectivity-test.md). No external
connection was attempted. This is local test readiness only: production still
needs a shared replay store, distributed rate limiting and per-room issuance
authorization before privileged worker configuration reads are enabled.

Phase 3.10A verification: Python worker tests 16 passed; Next.js unit and
route tests 31 passed; lint, TypeScript and production build passed. Public
Playwright had 4 passed and 4 authenticated cases skipped because disposable
fixtures were not active for this run. Root and `/api/health` returned HTTP
200. The worker boundary now fails closed in production regardless of a
`distributed` configuration label, because a real shared replay/rate-limit
store is not yet implemented. No external LiveKit or provider connection was
performed.

## Phase 3.10B isolated connectivity setup (approval gate)

The local Supabase API responded on loopback, and two disposable local Auth
users, two organizations, memberships, agents, a contact and a draft campaign
were prepared. Actual local PostgreSQL RLS checks passed for membership and
Agents/Contacts/Campaigns tenant isolation. An isolated Next.js test server
used local Supabase values on port 3002; authenticated Playwright passed 8/8
after a login hydration race was fixed. No production account or record was
used. The ordinary development preview remains on localhost:3000.

The private `.env.livekit-test.local` exists and is Git ignored. Its three
Supabase values were synchronized from the isolated local CLI without showing
them. The offline preflight passed for local keys, matching secure LiveKit URL
origins, test host, disabled activation flags and mock provider mode. This does
**not** establish that the LiveKit API key/secret belong to a separate project
or that a room can be joined; those require user confirmation and an approved
external connectivity test.

The worker configuration boundary now requires a signed request, an exact
room/agent/organization match, a scoped agent lookup, and a matching
single-use browser-issued room authorization (five-minute local in-memory
record). This is for one local Next.js process only; production remains
fail-closed until a distributed room authorization/replay/rate-limit system is
implemented. Connectivity tokens still cannot publish audio or data; the
worker connectivity branch has no publish/subscribe/metadata permissions and
does not initialize STT, LLM or TTS. Outbound calling remains disabled.

Verification at this gate: Python 17 passed, Next.js unit/security 37 passed,
lint/typecheck/build passed, and local
authenticated Playwright 8 passed. The first browser-to-worker LiveKit room
join is **not run**; no external LiveKit connection, provider request or call
was started. Explicit approval is required before turning on connectivity
flags, registering the worker, or joining a room. See
[the isolated test procedure](livekit-connectivity-test.md).
The final local RLS rerun passed, root and health returned HTTP 200, and a
read-only scan of 28 built browser assets found no private LiveKit API secret,
worker shared secret or local Supabase service-role key. LiveKit key validity
and worker-to-browser participant visibility are still untested.

## Phase 3.10B one approved isolated LiveKit connectivity attempt — 2026-10-22

The user confirmed that the configured LiveKit Cloud project was separate and
approved **one** connectivity-only browser-to-worker test. The approved
attempt marker was written before worker registration; no retry occurred.
The private test file stayed Git ignored with connectivity, worker, realtime
and outbound flags `false` throughout. Launchers enabled only connectivity
and worker flags in the short-lived test processes. Local Supabase keys were
compared with the local CLI without displaying them. Docker, local Auth, SDK
imports, official AgentServer construction, disposable fixture membership and
local RLS were checked before connecting. No claim is made that offline checks
independently proved Cloud project ownership.

| Check | Result |
| --- | --- |
| Worker registration with isolated project | PASS; sanitized worker log contained `registered worker` |
| Disposable local Auth and organization-scoped agent | PASS; local login, agent visibility, scoped token and signed configuration lookup |
| Browser room connection | PASS; one token request and one browser join |
| Worker configuration verification and room join | PASS; sanitized markers `VOICEPILOT_CONNECTIVITY_CONFIG_VERIFIED` and `VOICEPILOT_CONNECTIVITY_WORKER_JOINED` |
| Participant visibility | PASS; browser observed one remote participant |
| Microphone publishing prevention | PASS for checked controls: zero browser microphone API calls, no UI publish call, and token/worker publish grants disabled; media stats were not separately collected |
| AI providers and telephony | No STT/LLM/TTS initialization in the connectivity branch; provider mode stayed mock, outbound flag false, and no SIP grant was issued |
| Browser disconnect and state reset | PASS |
| Natural worker session disconnect event | **UNVERIFIED**; the marker was not observed within the 15-second wait |
| Forced worker cleanup | PASS; worker process stopped, local test server stopped, and one read-only Cloud room check returned zero active participants |

The automated runner returned failure because natural worker session
termination was not observed. This is a **partial connectivity success, not a
full lifecycle pass**. The absence of that marker may reflect room lifecycle
timing or the worker's disconnect handling; it was not resolved by another
connection attempt. Sanitized worker events above are the complete log
evidence retained in this report; raw credentials, tokens and room identities
were not recorded. No connection error was observed during registration or
joining. There was no microphone stream, AI provider request, outbound call,
or remote Supabase operation.

After the attempt, the worker and dedicated ports 3001/3002 were absent;
the read-only LiveKit check showed zero participants. The disposable local
users, organizations, agents, contact, and campaign were deleted through the
local-only fixture cleanup script; unrelated local data was preserved. The
in-memory room issuance record was removed with the test server process. The
private file's four activation flags remain disabled, and normal
`http://localhost:3000/api/health` returned HTTP 200. The one-attempt marker
remains as a safeguard against an accidental rerun. These disposable fixtures
can be recreated locally, but their prior data was not backed up.

Post-attempt regressions: Python pytest **17 passed**, Next.js unit/security
tests **37 passed**, ESLint **passed**, TypeScript **passed**, production build
**passed**, actual local PostgreSQL RLS test **passed**, and authenticated
Playwright **8 passed** with LiveKit flags off. Existing non-blocking Vite ESM
and Next.js package-root warnings remain.

Recommended Phase 3.11: make worker session termination deterministic when
the last non-agent participant leaves, unit-test that lifecycle locally, and
require **new explicit approval** for any live confirmation. Production also
still needs distributed room authorization, replay protection and rate
limiting, private worker networking, observability, provider review, and the
separately gated remote database migration/RLS verification. Do not enable
realtime voice, AI providers or outbound calling based on this test.

## Phase 3.11 local lifecycle hardening — 2026-10-22

Inspection of the installed LiveKit Python SDK showed distinct
`participant_disconnected` and room `disconnected` events. The previous worker
subscribed only to the latter and waited on it indefinitely; the local test
triggered that same room event, so it could not detect a browser-departure
handling gap. This is an evidence-supported code defect, but the retained
sanitized Cloud log does not establish whether a participant departure event
was actually delivered during the one approved attempt. Server-side timing or
other unobserved behavior remains possible.

The connectivity-only worker now obtains the authorized browser identity from
the single-use, server-issued room authorization returned across the signed
worker configuration boundary. It does not infer authorization from a room
name or arbitrary participant metadata. Its states are `initializing` →
`connecting` → `active` → `stopping` → `stopped` (or `cleanup_failed`). It
registers event handlers before joining, checks the post-join participant
snapshot, ignores unrelated departures, and stops when that browser leaves,
the room disconnects, or no authorized browser appears within a bounded
arrival window. Cancellation and connection failure also enter cleanup.
Cleanup is idempotent and bounded; the success marker is emitted only after
room disconnect succeeds. Structured logs contain state, reason and exception
type only, not identities, tokens or credentials. Browser disconnect is
awaited, stale session events are ignored, and microphone-permission responses
cannot revive a stopped mock session.

Local verification: Python pytest **23 passed**, Next.js Vitest **37 passed**,
ESLint **passed**, TypeScript **passed**, production build **passed**,
actual local PostgreSQL RLS test **passed**, and authenticated Playwright
**8 passed** using disposable local fixtures. Fixtures were removed afterward.
The private test file's worker, realtime, connectivity and outbound flags
were each checked as `false`. No LiveKit room, worker process, microphone
stream or provider connection was started for Phase 3.11.

Remaining risks as of Phase 3.11: local tests cannot confirm Cloud event delivery or natural
worker exit. The room authorization map is in-process, not a distributed
production mechanism; the current room name is shared by sessions for the
same organization and agent, so concurrent use needs a unique room identifier
and a distributed issuance record. Cleanup failure is logged and never
reported as a successful disconnect, but infrastructure may still need to
reap an orphaned participant. Phase 3.12 replaces the deterministic room name
with a unique session-scoped one; production distributed authorization is still
not wired. A future isolated LiveKit retest is recommended
only after **separate explicit approval**; the previous approval was consumed.

## Phase 3.12 local multi-tenant voice foundation — 2026-10-22

Session rooms now include a fresh UUIDv4, and room issuance binds the
organization, agent, authenticated user, session ID and five-minute expiry.
The worker's signed lookup includes the exact room name and checks the returned
session before joining. Expired or reused authorizations fail; token grants
remain restricted to one room. The worker also has a bounded session expiry.
An atomic security-store interface and Redis-compatible Lua/`SET NX PX`
adapter were prepared. No local Redis service was available; the adapter was
tested with a shared deterministic command double only. Production remains
fail-closed without a configured distributed store.

The separate offline mock pipeline implements bounded STT → LLM → TTS stages,
transcript events, tenant checks, cancellation, failure recovery and safe
termination. It does not stream microphone audio or invoke external providers.
See [voice-session-security.md](voice-session-security.md) for architecture
and deployment blockers. No new LiveKit Cloud connection, remote Supabase
operation, outbound call or paid provider request was performed.

Phase 3.12 verification: Python pytest **31 passed**, Next.js Vitest **38
passed**, ESLint **passed**, TypeScript **passed**, production build **passed**,
actual local PostgreSQL RLS test **passed**, and authenticated Playwright **8
passed** using disposable local fixtures. Fixtures were removed afterward;
`http://localhost:3000/api/health` returned HTTP 200. The private test
configuration's worker, connectivity, realtime and outbound flags were each
confirmed `false`. The build retains the non-blocking Next.js package-root
warning; Vitest retains its ESM configuration warning.
The generated browser bundles were checked for server credential identifier
names (`LIVEKIT_API_SECRET`, `VOICE_WORKER_SHARED_SECRET`, and
`SUPABASE_SERVICE_ROLE_KEY`); none were found. This name check is not a
substitute for a dedicated secret-scanning/release review.

Phase 3.13 recommendation: first verify the Redis adapter against a
disposable **local** Redis service and design production-safe distributed
store wiring plus JWT/room revocation. After a separate safety review and
new explicit approval, consider one isolated connectivity-only test of the
new room format and natural worker exit. Do not begin real AI provider or
outbound-call integration on the basis of the mock tests.

## Phase 3.13 local Redis and revocation verification — 2026-10-22

The official node-redis client is now wired behind an explicit security-store
selection. The disposable Redis 8.10.2 container was bound to
`127.0.0.1:16379` only. Real Redis tests exercised atomic nonces, concurrent
single-use room authorization, rate limits, TTLs, tenant isolation, revocation,
client-process loss, and recovery. A paused-container test initially failed
because TCP connected while the Redis handshake stalled; a bounded handshake
timeout was added, then startup-outage and established-command outage tests
passed. Production has no memory fallback and requires a TLS Redis URL; no
production Redis was contacted.

Local application-level termination marks an exact authenticated user's
session revoked. Revoked sessions cannot provide worker configuration or
re-register the same room while the authorization tombstone exists. This
does **not** revoke a previously issued LiveKit JWT or remove active room
participants. See [voice-session-security.md](voice-session-security.md) for
the implementation boundary, test setup and remaining controls. No LiveKit
Cloud connection, microphone stream, provider request, outbound call, remote
Supabase operation or migration occurred in Phase 3.13.

Phase 3.13 verification: Python pytest **31 passed**; Vitest without Redis
**48 passed, 12 skipped** (the guarded Redis cases), and with disposable local
Redis **58 passed, 2 skipped** (the destructive-to-test-container outage
cases). The two outage suites ran separately against that same disposable
container and **1 passed each**. ESLint, TypeScript, and production build
**passed**. Actual local PostgreSQL RLS checks **passed**; authenticated
Playwright **8 passed** with disposable local fixtures, which were removed
afterward. `http://localhost:3000/api/health` returned HTTP 200. The private
LiveKit test file explicitly sets all four activation flags to `false`; the
ordinary local environment omits them and the runtime defaults are disabled.
No server-secret identifier names were found in generated `.next/static` JS;
this narrow check does not replace a comprehensive release secret scan.
The local Redis container was stopped and auto-removed after verification.
Remaining blockers: previously issued LiveKit JWTs and active participants
cannot be revoked by the local termination endpoint, Redis TLS/ACL/HA and
operational failover remain unverified, and worker natural disconnect with
unique room names still needs a separately approved isolated LiveKit retest.

## Phase 3.14 local multi-provider runtime foundation — 2026-10-22

The worker now has provider-neutral streaming contracts for partial/final STT
transcripts, LLM response chunks and non-executable tool boundaries, and TTS
audio chunks. `mock` is the sole constructible provider type; Deepgram,
OpenAI, and ElevenLabs are future validation-only identifiers and real mode
fails closed. The bounded conversation controller scopes every turn to its
organization and agent, records state/diagnostic events, suppresses stale
output after interruption, propagates cancellation, and ends a session
deterministically. The protected agent console adds **Simulation — No Live
Audio**, a typed local mock STT → LLM → TTS flow with slow/failure/empty-output
and interruption controls. It performs no microphone capture or external call.

See [voice-provider-architecture.md](voice-provider-architecture.md) for
contracts, the state machine, and future-provider gates. Phase 3.14 full
verification: Python pytest **34 passed**; Vitest **52 passed, 12 skipped**
(the Redis-guarded tests); ESLint, TypeScript, and production build **passed**;
actual local PostgreSQL RLS checks **passed**; authenticated Playwright **9
passed** with disposable local fixtures, which were removed after the run.
`http://localhost:3000/api/health` returned HTTP 200. No Redis, remote
Supabase, LiveKit, provider, or external service was contacted.

## Phase 3.15 local provider-integration readiness — 2026-10-22

Provider governance now has a local registry for supported provider categories,
models, languages, and voices; an explicit server-side activation policy; a
test-only secret-reference store; tenant privacy policy checks; a deduplicated
usage/cost-estimation ledger; and metadata-only diagnostics. Real providers
must pass environment, organization, and agent approval independently, and
the worker rejects real-provider mode unless `VOICE_PROVIDER_ACTIVATION_ENABLED`
is explicitly set server-side. No real adapter exists, and the default remains
mock/fail-closed. See [provider-integration-readiness.md](provider-integration-readiness.md).

Phase 3.15 verification: Python pytest **41 passed**; Vitest **52 passed, 12
skipped** (Redis-guarded); ESLint, TypeScript, and production build **passed**;
actual local PostgreSQL RLS checks **passed**; authenticated Playwright **9
passed** with disposable local fixtures, which were removed afterward.
`http://localhost:3000/api/health` returned HTTP 200. A generated browser-bundle
identifier scan found no LiveKit, Supabase service-role, or provider secret
identifier names. No provider, LiveKit, remote Redis, or remote Supabase request
was made.

## Phase 3.16 local governance persistence — BLOCKED by local port exposure

Migration `202610220008_governance_hardening.sql` remains **unapplied**. It is
additive and contains idempotent indexes, update-timestamp triggers, and
admin-gated governance read/revocation RPCs. The static migration review found
no reason to apply it before the local environment can be demonstrated to be
isolated.

On 2026-10-24, Docker Desktop's Linux engine recovered and Supabase CLI was
updated to `2.122.0`. The local stack was then started with the documented
custom bridge network whose `com.docker.network.bridge.host_binding_ipv4` option
is `127.0.0.1`. Docker nevertheless published the API, database, Studio,
Mailpit, and Analytics ports on `0.0.0.0` and `[::]`. Container inspection
shows empty `HostIp` values for these published ports. This makes the stack
potentially reachable from the local network, so database initialization,
migrations, fixtures, RLS checks, and authenticated browser tests are blocked.

The current local PostgreSQL volume also contains no application schema or
migration ledger; this differs from the earlier expected disposable local state.
No migration is being inferred as applied, and no reset or recovery has been
attempted. The Vector container independently restarts because its Docker-log
source cannot reach Docker Desktop's internal endpoint at `192.168.65.254:2375`.
That diagnostic is separate from the published-port issue and has not been
remediated.

No remote database, Redis, provider, LiveKit service, call, or email was
accessed. Feature flags remain disabled. See
[the sanitized upstream-report draft](supabase-cli-network-binding-report.md).
Phase 3.16 may resume only after a supported, persistent loopback-only port
binding is available and the local database state is deliberately revalidated.

## Phase 3.17 local dashboard integration — 2026-10-24

The Agent Builder now exposes an admin-gated, per-agent provider-governance
panel. It uses the existing authenticated API routes and organization-scoped
RLS; it records policy approvals only and does not activate a provider, voice
runtime, telephony, or external integration. Settings already provides
organization approvals, privacy policy, quota configuration, estimated-usage
history, and an immutable audit view. Browser verification used only disposable
local users, organizations, and opaque credential-reference strings.

The dashboard repository now accepts PostgreSQL `timestamptz` values with an
explicit UTC offset, and recognizes the `approval_updated` audit action from
migration 010. Mutation routes share strict Origin-to-Host validation so the
loopback browser URL works without weakening CSRF protection.

Remaining schema risk: `audit_provider_governance()` in migration 010 accesses
`OLD.credential_reference` for `agent_provider_approvals`, which has no such
column. Inserts, revocations, and reapproval after a revocation use earlier
branches and work; a repeated upsert of an already-active agent approval can
fail. Correcting this requires a separately reviewed additive migration (for
example, guarding that field comparison to organization-level approvals). No
migration was created or applied during Phase 3.17.

## Phase 3.17.1 audit-trigger repair — review only, 2026-10-24

Migration `202610220011_agent_approval_audit_trigger_fix.sql` was applied on
2026-10-24 to the verified **isolated local** `voicepilot-local-loopback`
database only. It was not applied to any remote Supabase project. Migration 010 uses one audit trigger function for both
organization and agent provider approvals. The former has a
`credential_reference` column; the latter does not. An update of an active
agent approval therefore reaches an invalid `OLD.credential_reference` access
and fails before the audit row can be written.

Migration 011 separates those table branches without changing existing audit
rows, RLS, trigger ownership, or execute privileges. It records creation,
revocation, restoration, and meaningful agent updates; a retry that changes
only `updated_at` produces no duplicate audit event. The replacement retains
the fixed `pg_catalog, public` SECURITY DEFINER search path and revokes all
direct function execution from runtime roles.

Static migration tests cover the column boundary, all approval transitions,
idempotent active retries, and least-privilege function ACLs. Live isolated
PostgreSQL tests also verified initial approval, idempotent active retry,
meaningful approver update, revocation, re-approval, organization credential
reference auditing, RLS cross-tenant denial, unauthorized mutation rejection,
and immutable audit events. Disposable users, organizations, and records were
removed afterward. No remote database or external provider was contacted.

## Phase 3.18 local governance UX and simulation preflight — 2026-10-25

The governance audit API now filters and paginates only after the authenticated,
selected-organization audit RPC has returned its scoped result set. The settings
screen adds action and text filters plus pagination controls. The mock agent
console now requires a read-only, server-verified simulation preflight that
confirms the selected organization, agent ownership, agent completeness, and
the mock-only provider/quota/privacy boundary before it runs. It does not create
a provider reservation or external session.
