# VoicePilot AI

Phase 1 foundation for a multi-tenant AI telecalling SaaS. The marketing shell and dashboard are runnable without credentials; Supabase-backed auth, onboarding, persistence, and RLS activate after environment setup.

## Run on Windows
```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```
Open http://localhost:3000. Apply `supabase/migrations/202610220001_phase1.sql` in the Supabase SQL editor. Configure Auth email URLs for `http://localhost:3000/auth/callback` and enable email provider.

Apply migrations in filename order, including `202610220002_security_and_onboarding.sql`. In Supabase Auth, enable Email provider, set Site URL to `http://localhost:3000`, and add `http://localhost:3000/auth/callback` as a redirect URL. Copy only the project URL and anon key into `.env.local`; never place a service-role key in browser-exposed variables.

The server and browser clients use `@supabase/ssr` cookie sessions. With no Supabase variables, the marketing site remains available and protected routes do not claim to be authenticated. Contact persistence returns a clear configuration error rather than a fake success.

## Scope notes
Live telephony, campaign execution, billing, email delivery, and worker services are not activated. The current product supports organization-scoped configuration and local simulation workflows; no demo metrics are represented as customer activity. See `docs/phase-3-acceptance.md` for the acceptance checklist and future-provider handover requirements.

## Local simulation capabilities
The dashboard includes simulation-only campaign orchestration, deterministic voice-agent testing, consent-aware queue previews, synthetic analytics, and provider-readiness indicators. These workflows use local mock state and server authorization preflight; they do not place calls, send messages, capture microphone audio, contact AI providers, or persist simulated business outcomes. Real telephony, LiveKit, STT, LLM, and TTS integrations remain disabled until separately configured and approved.

Release-readiness boundaries: campaign queue reset requires a fresh authorization check; synthetic report exports are local JSON/CSV only, marked SIMULATION ONLY, and omit contact identifiers by default. The isolated E2E runner fails closed unless it can verify the loopback listener belongs to the launched test server. Real provider integration remains blocked pending separate credentials, distributed controls, consent/compliance review, and approval.
