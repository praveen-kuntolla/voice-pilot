# Phase 8C — Enhanced Offline Agent Voice Configuration QA

## What it is

A reusable, simulation-only mock voice configurator inside the Agent Builder (`src/components/mock-voice-configurator.tsx`), extending the Phase 8A catalog and replacing the Phase 8B single-selection block with a fuller ephemeral configuration: mock voice profile, speaking-rate hint (slow/normal/fast), optional bounded style note, and a deterministic text-only preview.

## Configuration model

`buildMockVoiceConfig()` in `src/lib/voice-profiles.ts` is a pure validator: unsupported profile rejection, language-tag format and base-language compatibility (reusing the 8A rule via `isProfileLanguageCompatible`), speaking-rate enum validation, style-note length (≤160) and control-character rejection. Results are deterministic and describe no provider, persistence, or audio behavior.

## Safety and privacy boundary

- All configuration is React state only. No localStorage, sessionStorage, cookies, URL parameters, database writes, or network requests.
- The agent POST/PATCH payloads are byte-identical to Phase 8B; the mock configuration is never included.
- Context switches (edit target change, new-agent form, agent language change), save, cancel, unmount, and reload reset the entire configuration. The configurator reports `null` to the parent on any invalidation; editing any control invalidates the applied configuration until it is re-applied, so stale asynchronous updates cannot restore cleared selections.
- SIMULATION ONLY labeling is present in the configurator, summary, and preview; the UI states the configuration never controls real speech.
- No audio playback, provider activation, LiveKit, telephony, or customer data.

## Runtime integration (reviewed, pure capability only)

The Agent Test Studio configuration cannot be transported across navigation without storage APIs, which are prohibited. Per the milestone plan, only a pure runtime capability was added: `runtimeConfigSchema` accepts an optional bounded `mockVoiceLabel` (descriptive only) and `mockVoiceSessionLabel()` renders a deterministic "(simulation label only)" label. No UI wiring transports configuration between pages; that remains a future milestone requiring an approved design.

## Reproducible checks

```powershell
npm test -- --run tests/mock-voice-config.test.ts
npm run typecheck; npm run lint; npm test; npm run build
npx playwright test tests/e2e/phase-8c-voice-config.spec.ts   # requires isolated fixtures
```

## Verification evidence (2026-10-31)

- TypeScript, ESLint: pass. Vitest: **264 passed / 20 skipped** (11 new). Production build: pass. `git diff --check`: clean. Python worker: **51 passed**.
- Authenticated Playwright (phase-8c + updated phase-8 specs): **NOT RUN** in the verification environment — requires approved disposable local Supabase fixtures; marked not-run, not passed.
- Public browser smoke: pass.

## Manual review checklist

- [ ] Confirm the configurator resets on agent switching, language change, save, cancel, unmount, and reload.
- [ ] Confirm agent create/update payloads remain unchanged (no mock voice fields).
- [ ] Confirm keyboard operability (labelled selects/inputs) and mobile single-column layout.
- [ ] Confirm SIMULATION ONLY labeling is unambiguous and never implies provider activation.

## Dependencies

Stacked on PR #25 (`feature/phase-8b-voice-profile-assignment` @ `646d658`), which is stacked on PR #24. Independent human review (Issue #21) remains outstanding for all phases.
