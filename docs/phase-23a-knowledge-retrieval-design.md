# Phase 23A — Review-only knowledge retrieval design

Status: proposal only. This document does not authorize migrations, background workers, embedding providers, remote URL fetches, file uploads, or agent retrieval.

## Current contract and limitation

The approved `knowledge_sources` table stores an organization ID, title, source type (`text`, `url`, or `file`), one bounded `source_uri` value, status, creator, and timestamps. Row-level security allows organization members to read and owners/admins to write. There is no agent-to-source relationship, content object, extraction record, chunk table, embedding table, retrieval endpoint, or indexed state. The current runtime config therefore reports an empty `knowledge_source_ids` list.

The product must describe these rows as stored references only. `ready` currently means the row was persisted; it must not be interpreted as extracted, indexed, embedded, or retrievable.

## Proposed reviewed pipeline

1. **Ingestion.** Accept text only after size, encoding, and content-policy validation. Treat URL and file rows as references until an explicitly approved ingestion job claims them. URL fetching must use an allowlisted outbound service with SSRF protections, bounded response size, content-type checks, timeout, redirect policy, and audit correlation IDs. File ingestion must use private object storage, malware scanning, MIME validation, and tenant-bound object keys.
2. **Extraction.** Run in an isolated worker with bounded CPU, memory, decompressed size, page count, and execution time. Preserve the original reference and record extractor version, content hash, and sanitized failure state. Never execute document macros, scripts, or embedded links.
3. **Chunking.** Normalize text deterministically, retain source offsets/page metadata, cap chunk size and overlap, and version the chunking algorithm. Chunks must be immutable for a source revision.
4. **Embeddings.** Use an approved provider or reviewed local model only after data-region, retention, PII handling, and cost controls are approved. Store model/version, dimensions, content hash, and failure state. Do not send tenant content to a provider by default.
5. **Tenant-isolated retrieval.** Resolve actor, organization, agent, and assignment server-side. Apply organization and assignment predicates before vector search, enforce a result/count/token budget, redact sensitive metadata, and log only sanitized correlation and policy outcomes. Retrieval must fail closed on missing membership, assignment, index health, or policy state.
6. **Agent assignments.** Add an owner/admin-controlled relationship table only through an additive, idempotent, reviewed migration. Enforce same-organization source and agent IDs, unique assignment pairs, archived-source/agent handling, and explicit revocation/deletion semantics. Members may not self-assign sources.
7. **Deletion and retention.** A source deletion must revoke assignments, stop new retrieval, enqueue deletion of extracted text/chunks/embeddings/object data, and retain only minimal sanitized audit evidence for the approved retention period. A reconciliation job must detect orphaned derived data and retry bounded cleanup. Legal holds and tenant export/deletion requirements need explicit review.

## Approval gates

Before implementation, approve the schema and RLS design, storage and data-region policy, provider/model choice, SSRF and file-security controls, retention/deletion contract, operational worker identity, cost/rate limits, audit fields, and authenticated tenant-isolation tests. No current UI claim implies retrieval readiness.
