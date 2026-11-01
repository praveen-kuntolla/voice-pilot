# Phase 11B Security Review Handoff

## Scope and dependency chain

The Phase 11B stack is reviewed in order: PR #36 (durable session authorization),
PR #37 (transactional admission preparation), PR #38 (distributed admission
verification), PR #39 (Linux crash-test CI), and PR #40 (transaction-acceptance
hardening). These pull requests remain draft and unmerged.

Migrations 017 and 018 are review-only. They must be applied only to a newly
identified disposable PostgreSQL database. The established local ledger remains
001–011.

## Trust boundaries

- The authenticated server is the tenant-bound admission boundary.
- `service_role` is required for the SECURITY DEFINER routines; `anon` and
  `authenticated` receive no table or routine privileges for this state.
- PostgreSQL is authoritative for authorization consumption, expiry, revocation,
  usage reservation and release state.
- The Python worker must receive gateway authorization before entering its
  lifecycle; local worker state is not sufficient for admission.
- No LiveKit, telephony, STT, LLM or TTS provider is enabled by this stack.

## Verified evidence

Ubuntu disposable PostgreSQL run [41277362110](https://github.com/praveen-kuntolla/voice-pilot/actions/runs/41277362110)
passed on the PR #40 head. The harness verified crash-before-commit rollback,
post-commit lost-result recovery, replay rejection, database-unavailable
fail-closed behavior, competing revoke/consume outcomes, repeated revocation,
tenant mismatch, audit-insert fault rollback, and retry after that rollback.

The audit fault test uses a temporary trigger in the randomized database. It
verified that a failed `consumed` audit insert did not leave `consumed_at` or a
usage reservation and that the same authorization could be retried afterward.

Fresh local checks: Vitest 282 passed / 20 skipped, Python 67 passed,
TypeScript passed, ESLint passed, production build passed with temporary
loopback Supabase variables, and `git diff --check` passed. Local PostgreSQL
was not run because the Windows environment has no `psql`; the Ubuntu job is
the authoritative database result. Browser tests were not run for this focused
database harness change.

## Semantics and limitations

- A revoke/consume race has two valid serialized outcomes: revocation wins and
  admission is rejected, or consumption wins and the authorization is admitted;
  revoking afterward does not terminate an already admitted provider session.
- Repeated revocation and release are idempotent and do not append duplicate
  terminal transitions.
- A consumed, unreleased authorization may return the original session for an
  identical retry; it cannot create a second worker session.
- Migrations 017–018 do not themselves implement the earlier replay, rate,
  spending, or provider-concurrency reservation tables. Those controls remain
  dependent on the durable-safety layer and require their own acceptance tests.
- Durable database state does not prove provider-side disconnect, media
  termination, webhook delivery, billing settlement, or distributed worker
  behavior after a real provider connection.

## Human review checklist

An independent PostgreSQL/Supabase security reviewer should verify SECURITY
DEFINER ownership, exact grants, `search_path`, transaction-lock scope,
organization context binding, RLS policy interaction, expiry semantics and
audit immutability. A voice-platform reviewer should separately approve worker
gateway failure handling, emergency-stop propagation, provider disconnect
semantics, retention, spend limits and rollback procedures.

Codex and GitHub CI evidence are not independent human approval. A qualified
reviewer is still required before any real voice-sandbox connectivity test.
