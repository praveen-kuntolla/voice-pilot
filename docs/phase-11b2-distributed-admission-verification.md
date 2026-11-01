# Phase 11B.2 — Distributed admission verification

This stacked, review-only branch verifies the migration 018 transaction boundary without enabling providers or changing the established database.

## Trust boundary

The browser and worker may present a signed assertion, but signature validity is not authorization. The server-side PostgreSQL routines bind actor and organization context, lock the organization admission key, check expiry/revocation/emergency stop, consume the assertion once, reserve bounded usage, and write minimized audit events. Client roles cannot execute these routines.

The Python worker integration is dependency-injected: it must receive an authoritative gateway result after local signature verification. A missing or failed gateway denies admission. Terminal release is sent back through the same gateway; no worker-only state can authorize a live session.

## Disposable evidence

`scripts/test-session-admission.mjs` creates a randomized database only after verifying the existing loopback container, applies review-only migrations 012–018 there, runs two independent `psql` processes against the same assertion, and drops the database in `finally` cleanup. The concurrent test observed exactly one first consumption and one idempotent reuse. It also verifies replay, tenant mismatch, release, and audit lifecycle evidence.

Established `voicepilot-local-loopback` remains at migrations 001–011. No remote or production database is used.

## Limits and human review

The current acceptance harness does not yet fault-inject every existing safety reservation or simulate a process crash during commit. Durable replay after database restart, distributed usage accounting across all provider controls, key management, and production credential separation remain required before real connectivity. These gaps are not covered by standard Chromium or in-memory tests.
