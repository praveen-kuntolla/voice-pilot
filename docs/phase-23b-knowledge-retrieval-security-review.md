# Phase 23B — Knowledge retrieval architecture and security review

Status: **REVIEW ONLY**. No migration, SQL, provider, embedding, file-processing, remote-fetch, or retrieval implementation is authorized by this document.

## Executive findings

The current contract is a safe reference registry, not a knowledge-retrieval system. `public.knowledge_sources` stores `organization_id`, title, source type, one bounded `source_uri`, persistence status, creator, and timestamps. Members can read organization rows; owners/admins can write them. The API repeats the tenant predicate and server-side membership check. The agent model has no knowledge relationship, and `/api/internal/voice-agent/config` returns `knowledge_source_ids: []`.

The current `ready` status means only that the reference row was persisted. It is not evidence of extraction, indexing, embeddings, or retrieval. Any future implementation must add explicit derived-data state and must not reinterpret existing rows implicitly.

## Contract comparison and gaps

| Area | Current contract | Required addition before implementation |
| --- | --- | --- |
| Source content | `source_uri` contains text or a URL/file reference | Immutable source revisions and protected content/object metadata |
| Ingestion | None; URL/file values are never fetched | Bounded, idempotent ingestion jobs and worker leases |
| Extraction | None | Versioned extraction result, content hash, sanitized failure state |
| Chunks | None | Tenant-bound immutable chunks with source offsets and algorithm version |
| Embeddings | None | Model/version/dimension metadata, vector storage, cost and retention controls |
| Retrieval | None | Server-side authorization before bounded vector search |
| Assignment | None; runtime always sends an empty list | Owner/admin-controlled same-tenant assignment relation |
| Deletion | Deletes only the source row | Revocation plus durable derived-data cleanup and reconciliation |

## Proposed review-only schema shape

These are logical records, not executable SQL. Any migration must be additive, idempotent, separately reviewed, and applied only after approval.

### Source revisions and content

Retain `knowledge_sources` as the user-visible source identity. Add a revision record keyed by source and revision ID with: organization ID, source ID, content kind, private object key or protected text reference, byte/character size, normalized content hash, source ETag/last-modified when applicable, parser version, lifecycle state, failure code, created-by, and timestamps. Do not put large documents or raw extracted content into an unbounded browser-readable row.

The source row needs an explicit lifecycle distinct from persistence: `reference_only`, `queued`, `fetching`, `extracting`, `chunking`, `embedding`, `indexed`, `failed`, `deleting`, and `deleted`. State transitions must be server/worker controlled and monotonic except for bounded retry transitions.

### Ingestion jobs

Add a tenant-bound job record with source/revision IDs, operation, idempotency key, attempt number, lease owner, lease expiry, next-attempt time, bounded retry count, sanitized failure code, and timestamps. Claiming must be atomic; expired leases must be reclaimable; duplicate requests must return the existing job rather than enqueueing unbounded work.

### Chunks

Add immutable chunks keyed by revision and ordinal, with organization ID, normalized text or protected content reference, character/token counts, source offsets/page metadata, chunker version, content hash, and lifecycle. Enforce same-tenant source/revision foreign-key paths and uniqueness on revision plus ordinal/hash as appropriate.

### Embeddings

Add embedding records keyed by chunk and model revision, with organization ID, provider/model identifier, dimensions, vector/index state, content hash, created/retired timestamps, and sanitized failure state. Keep provider credentials out of rows and browser responses. Make model versions explicit so re-embedding cannot silently mix incompatible dimensions.

### Agent assignments

Add a relationship record containing organization ID, agent ID, source ID (or source revision policy), assigned-by, active/revoked state, and timestamps. Enforce a same-organization agent/source invariant, unique active assignment, and no assignment to archived/deleting sources. Owners/admins may manage assignments; members may read only what their normal role permits. The runtime must receive only server-resolved active IDs after authorization.

### Retrieval boundary

Use a server route or trusted worker operation that receives an agent/query context but never trusts organization, agent, source, or permission claims from the browser. Resolve the authenticated actor and selected organization, verify agent ownership/membership, load active assignments, apply tenant and lifecycle predicates before vector search, enforce top-K/token/latency/budget limits, and return bounded citations with no raw storage keys or sensitive metadata.

## URL ingestion security

URL creation may remain metadata-only until these controls are approved and implemented:

- Accept only `http`/`https`; reject credentials, unsupported ports, fragments where not needed, non-ASCII confusion cases, and excessively long URLs.
- Resolve DNS in the fetcher and reject loopback, link-local, private, carrier-grade NAT, multicast, documentation, reserved, and metadata-service IPv4/IPv6 ranges. Re-check the destination after every redirect and prevent DNS rebinding between resolution and connect.
- Use an egress-isolated fetch worker with no access to Supabase/Docker/admin networks. Do not forward browser cookies, authorization headers, or ambient credentials.
- Bound redirects, response headers, connection time, total download bytes, decompressed bytes, content type, and redirects to non-HTTP schemes. Reject streaming responses without safe limits.
- Allowlist document MIME types and validate magic bytes. HTML needs a separate sanitized extraction path; do not execute scripts or follow embedded links. Store only sanitized content and provenance.
- Record sanitized URL/fetch outcome and correlation ID, never response bodies or credentials in logs.

## File ingestion security

- Use private tenant-bound object storage keys; never accept a client-provided storage path as authority.
- Enforce upload size, decompressed size, page count, nesting depth, filename length, and total job time before parsing.
- Validate MIME by magic bytes, reject executable/script/macro formats and unsupported archives, and scan accepted files for malware.
- Parse PDFs, Office documents, and archives in a sandbox with no network, no credentials, read-only input, resource quotas, and a non-privileged identity. Defend against zip bombs, parser exploits, external entity expansion, macros, and embedded remote resources.
- Preserve the original as retention policy permits, but expose only sanitized metadata and bounded previews to ordinary clients.

## Tenant isolation and trusted worker boundary

The browser remains untrusted. Server routes must derive actor and organization from the authenticated session/cookie and repeat organization predicates on every read/write. Cross-tenant foreign keys must be blocked by database constraints or trusted transactional checks, not only UI filtering.

Workers need a dedicated identity with least privilege and an explicit signed job/lease contract. A service-role client must never be exposed to the browser, and worker queries must bind organization/source/revision context transaction-locally. Every worker operation must verify source ownership, assignment state, lease ownership, cancellation/deletion state, and current policy before touching content. Worker audit output must contain only event type, tenant-safe correlation ID, state, reason code, and timestamps.

## Deletion, retention, retries, and recovery

Deletion must first mark the source unavailable for new retrieval and revoke active assignments. It must enqueue deletion of revisions, extracted content, chunks, embeddings, and private objects, with idempotent tombstones and bounded retries. A reconciliation job must find orphaned derived records and expired leases without scanning or exposing tenant content.

Define retention separately for original references, uploaded originals, extracted text, chunks, embeddings, job metadata, and sanitized audit events. Support legal holds and tenant export/deletion requirements before enabling ingestion. Failed jobs need stable reason codes, exponential backoff with jitter, maximum attempts, dead-letter state, operator-safe replay, and no automatic retry of policy/security failures.

## Embedding provider and cost decisions

Before provider activation, approve: provider/model and data region; whether tenant content may leave the environment; retention/training terms; PII handling; dimensions and index technology; maximum characters/tokens per revision; per-tenant daily/monthly quotas; concurrency and queue limits; retry cost ceilings; model-version migration policy; and deletion guarantees. A local/offline deterministic adapter may be used for contract tests, but it is not evidence of provider compatibility or production retrieval.

## Phased implementation plan and acceptance criteria

### Phase 23B.1 — Contract and threat-model approval

Approve the logical schema, state machine, trust boundaries, URL/file threat model, retention schedule, audit fields, and provider/data-region decision. Acceptance requires security review sign-off and a documented no-provider test mode.

### Phase 23B.2 — Source revisions and jobs

Add only reviewed additive schema and server APIs. Acceptance requires same-tenant invariants, owner/admin authorization, idempotent enqueueing, lease recovery, bounded retries, cancellation, and no browser access to worker credentials or raw object keys.

### Phase 23B.3 — Sandboxed extraction and chunking

Implement text-only/local fixtures first. Acceptance requires resource quotas, parser isolation, deterministic hashes, versioned chunks, malformed/oversized/archive-bomb tests, and sanitized failure telemetry.

### Phase 23B.4 — Embedding adapter and index

Start with an offline contract adapter. Acceptance requires dimension/model metadata, tenant predicates before search, quotas, cost accounting, deletion/reconciliation tests, and an explicit provider approval before any external call.

### Phase 23B.5 — Assignments and retrieval

Add assignment APIs and the trusted retrieval boundary. Acceptance requires cross-tenant denial, archived/deleting-source denial, member/admin role tests, bounded result/citation output, stale-assignment revocation, and runtime config tests proving only server-authorized IDs are returned.

### Phase 23B.6 — Controlled activation review

Only after independent security, privacy, operations, and product approval may a provider or production worker be enabled. Monitor queue health, cost, denial reasons, deletion lag, orphan counts, and retrieval quality without logging tenant content.

## Approval checklist

- [ ] Additive schema and RLS reviewed; no direct client DML on derived tables.
- [ ] Same-tenant source/revision/chunk/embedding/agent invariants enforced.
- [ ] URL SSRF, DNS rebinding, redirect, content, timeout, and egress controls tested.
- [ ] File MIME, malware, archive, parser sandbox, decompression, and resource controls tested.
- [ ] Worker identity, signed job/lease contract, secret isolation, and transaction context approved.
- [ ] Assignment role matrix and revocation semantics approved.
- [ ] Retrieval limits, citations, redaction, audit minimization, and fail-closed behavior approved.
- [ ] Retention, legal hold, export, deletion, orphan reconciliation, and retry policy approved.
- [ ] Provider/model, data region, training/retention terms, quota, cost, and rollback approved.
- [ ] Authenticated cross-tenant, deletion, stale lease, failure recovery, and no-provider tests pass.
- [ ] Explicit approval recorded before executing any migration or enabling any provider.

## Remaining blockers

No approved schema exists for content, jobs, chunks, embeddings, assignments, or retrieval. No approved object storage, worker identity, parser sandbox, vector index, provider/model, retention schedule, or operational budget exists. Consequently, Phase 23B should remain review-only; implementation must not proceed by inferring these decisions from the current `knowledge_sources` table.
