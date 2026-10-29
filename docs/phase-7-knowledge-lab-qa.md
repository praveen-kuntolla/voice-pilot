# Phase 7 — Offline Knowledge Lab QA

## What it is

The Knowledge Lab is a browser-memory-only, **extractive retrieval preview** in the authenticated Agent Test Studio. A user may add clearly labelled fictional text or Markdown notes, enter a mock question, and inspect up to three verbatim, cited source excerpts. It is not semantic search, vector search, RAG, knowledge ingestion, or an AI-generated answer.

The deterministic matcher normalizes and tokenizes lexical terms, splits each source into bounded passages, then ranks passages by the number of distinct meaningful query terms they contain. Equal scores use source order and excerpt index as stable tie-breakers. Every displayed excerpt is a substring of the selected source, with its exact source title and excerpt index.

## Safety and privacy boundary

- Only `.txt` and `.md` files selected through the browser and pasted text/Markdown are accepted. Files are read locally with browser APIs; they are never uploaded.
- Limits are five sources, 10,000 characters per source, 40,000 total characters, and 500 characters per question.
- Source text, questions, and excerpts are React state only. The feature does not use localStorage, sessionStorage, IndexedDB, Supabase writes, uploads, analytics, or telemetry.
- Source content is rendered as plain text. It is untrusted data: text such as `ignore prior instructions` is not executed or followed.
- The existing transcript preview/export does not include Knowledge Lab sources, questions, or excerpts. Copying an excerpt into the simulation input is a visible user action and does not create an event until the user separately runs the local simulation.
- No LLM, STT, TTS, LiveKit, telephony, microphone, provider, message, billing, or network provider action is introduced.

## Authorization lifecycle

Knowledge Lab access uses the already-existing server-authoritative Agent Test Studio preflight; it does not invent a browser organization claim. Reset, agent change, malformed/denied preflight, an organization/agent mismatch, and unmount clear the current controller and invalidate browser Knowledge Lab state. A new successful preflight is required before sources can be added or searched. Transcript export remains hidden while preflight is revalidated and after denial.

## Reproducible checks

Focused pure tests:

```powershell
npm test -- --run tests/knowledge-lab.test.ts
```

Offline project checks:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

The Phase 7 browser scenarios are in `tests/e2e/phase-6-agent-studio.spec.ts` and require the existing, explicitly verified `voicepilot-local-loopback` environment plus disposable fixtures. They cover cited retrieval, explicit no-match behavior, and clearing sources/excerpts on an authoritative `403` preflight. If those fixtures are unavailable, the authenticated suite is reported as **NOT RUN**, never as a pass.

## Review notes and limitations

- The matcher is intentionally lexical and can miss synonyms or differently phrased relevant text. It never fills gaps with generated facts.
- Browser-memory-only handling is a privacy boundary, not a certification against all client-device data exposure; users must use fictional/synthetic sources in this phase.
- Source titles and content are user-provided text. Exports exclude them by default, but a user must still review any separately copied local content before sharing.
- GitHub Issue #21 remains the independent human review/sign-off dependency for inherited Phase 6 safety boundaries. This Phase 7 PR must remain draft and must not request merge readiness until that review is complete.
