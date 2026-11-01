# Phase 9–10C Independent Security Review Handoff

Status: review preparation only. All listed PRs remain open, draft, and unmerged.

## Dependency graph

```text
PR 27 → PR 28 → PR 29 → PR 30 → PR 31 → PR 32 → PR 33
```

PR 27 establishes the provider-neutral call lifecycle. PR 28 adds offline provider-sandbox contracts. PRs 29–32 add the authorization envelope, admission checks, signed worker assertions, and offline admission integration. PR 33 records the Phase 10C audit and review gate.

PRs 23–26 are separate Phase 7/8 draft workstreams and are not prerequisites for the Phase 9–10C merge chain. They require their own independent review of Knowledge Lab privacy, voice-profile state, and configuration boundaries.

## Trust boundaries and sensitive paths

- Browser requests are authenticated and organization-scoped before protected dashboard or simulation operations.
- Server-side authorization binds organization, agent, actor, session, expiry, capability, emergency-stop, usage, and concurrency claims.
- Signed server-to-worker assertions use canonicalized claims and bounded expiry/replay inputs.
- The Python worker verifies signed admission before entering the offline lifecycle.
- Phase 9 lifecycle transitions are terminal-state protected and support cancellation/cleanup.
- Real providers, LiveKit connectivity, microphone capture, STT, LLM, TTS, telephony, messaging, and billing remain disabled.

Security-sensitive files include the Phase 9 lifecycle contracts, sandbox authorization/admission modules, signed worker verifier, LiveKit-admission boundary, provider safety controls, and the isolated E2E runner.

## Evidence

Fresh isolated local E2E on PR 33 head `a0d0b74a7ecc2c11b91a2624eba12e74137f8795`:

- Authenticated Playwright: **29 passed, 3 skipped, 0 failed**.
- Covered login, protected routes, organization switching, tenant isolation, agent authorization, governance, admission denial, revocation, cancellation, emergency-stop/provider-disabled behavior, stale-response handling, downloads, and navigation.
- Disposable cleanup passed: fixture metadata absent; disposable users, organizations, and agents were confirmed absent; test server listener was absent.
- Docker project `voicepilot-local-loopback` was healthy with API `127.0.0.1:55421`, PostgreSQL pooler `127.0.0.1:55422`, Studio `127.0.0.1:55423`, independent volume `voicepilot-local-loopback-db`, and ledger `001–011`.

GitHub CI on the exact PR 33 head passed TypeScript/ESLint/Vitest/build, Python worker tests, and synthetic developer-preview Chromium. Prior inherited offline evidence was Vitest 277 passed / 20 skipped and Python 65 passed.

## Known limitations and blockers

The current evidence is offline and local. It does not prove:

- durable replay, revocation, usage, concurrency, or idempotency enforcement;
- production-grade key storage, rotation, or provider-specific signature verification;
- termination of a real LiveKit participant or provider session;
- microphone permission, transcript retention, or real-time provider privacy behavior;
- provider outage, billing, rate-limit, or operational monitoring controls.

The local replay and lifecycle protections must not be represented as production durability. No real provider connection or production credential has been used.

## Human reviewer checklist

- [ ] Verify every tenant and actor identity is derived from trusted authentication context, not caller-controlled claims.
- [ ] Verify replay and revocation semantics remain fail-closed when state is unavailable or stale.
- [ ] Verify signed assertion canonicalization, key selection, expiry, and algorithm restrictions.
- [ ] Verify emergency stop and usage/concurrency limits are authoritative at the provider-admission boundary.
- [ ] Verify failed admission and cancellation cannot leave active sessions or reusable capacity.
- [ ] Verify no provider, microphone, customer-data, or secret path is reachable while flags are disabled.
- [ ] Verify production requirements for durable stores, secret management, monitoring, retention, and incident response.
- [ ] Confirm the stacked merge order and review each PR against its own diff and CI evidence.
- [ ] Independently approve or reject the first isolated real voice-sandbox procedure; Codex evidence is not human approval.

## Safe merge order after approval

Review and merge the dependency chain in order: PR 27, then 28, 29, 30, 31, 32, and finally 33. Keep PRs 23–26 on their separate review tracks. Do not merge any item until its independent human review and required checks are complete.

## Owner actions required

1. Assign an independent security reviewer and record their review on the relevant PRs/Issue #21.
2. Decide whether the offline limitations are acceptable for merging, separately from production launch approval.
3. Approve a written, single-session real voice-sandbox test plan only after durable controls and provider-specific requirements are addressed.
4. Keep all provider flags disabled until that approval is explicit.
