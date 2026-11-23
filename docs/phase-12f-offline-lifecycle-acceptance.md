# Phase 12F offline worker-lifecycle acceptance

`OfflineWorkerLeaseLifecycle` is a deterministic test model for the reviewed lease contract. It is not a worker, endpoint, database adapter, provider integration, or source of production authority.

The model verifies fail-closed behavior for duplicate cancellation, emergency stop during renewal, expired leases, stale generations, revoked worker keys, uncertain provider termination, idempotent reconciliation, and audit persistence failure. Capacity reaches `released` only after authoritative termination confirmation.

Production still requires the independently reviewed SQL RPC set, a durable audit sink, approved worker-key registry and rotation owner, authoritative provider termination evidence, a reconciler owner/SLO, and disposable PostgreSQL acceptance of the approved review-only migration. No timeout alone is termination evidence.
