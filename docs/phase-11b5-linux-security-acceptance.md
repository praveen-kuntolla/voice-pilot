# Phase 11B.5 — Linux crash-safe acceptance

The dedicated workflow uses `ubuntu-latest`, a disposable PostgreSQL 17 service, direct `psql` child processes, PID ownership, bounded waits, SIGTERM termination, persisted-state assertions, and `dropdb` cleanup. It does not use nested Docker process control.

The harness creates a randomized database, bootstraps only the minimum local auth schema, applies migration files 001–018 inside that database, and removes it in a `finally` path. It never targets the established loopback volume or remote Supabase.

Acceptance scenarios include crash before commit with rollback and retry, commit-state recovery after a lost client result, replay after the first process exits, and database-unavailable fail-closed behavior. A failed workflow is a hard failure; scenarios are not silently skipped.

This is still an offline acceptance harness. It does not prove production key management, durable replay across infrastructure failure, or provider safety. Independent security approval remains required before Phase 11C or live connectivity.
