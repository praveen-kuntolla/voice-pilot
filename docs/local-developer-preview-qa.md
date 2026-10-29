# VoicePilot local developer preview and QA

Status: **feature-branch implementation. Existing developer-preview Playwright (3 passed) and isolated authenticated Playwright (17 passed, 3 skipped) are reported in `docs/qa/pr-17-developer-preview.md`. Subsequent sidebar navigation/auth fixes require a fresh local rerun.**

## Safety boundary

- Route: `/developer-preview` on a Next.js development server on `localhost` or `127.0.0.1` only.
- The server calls `notFound()` in production mode or on a non-loopback Host header.
- The preview is a **separate synthetic, in-memory UI**. It does not sign in a user, create a privileged session, write to Supabase, call providers, or modify production safety controls.
- Developer preview operations only change React state in that browser tab. Reloading loses the changes.
- Real login and authenticated routes retain their existing protections. **Do not treat preview button success as evidence that real backend routes work**.

## Start and inspect locally

1. Open PowerShell in `C:\Users\PC\Documents\ChatGPT\voicepilot-ai`.
2. Check out this feature branch without overwriting uncommitted `next-env.d.ts` or `tsconfig.tsbuildinfo`; if switching would overwrite a file, stop and ask for a safe worktree.
3. Run `npm install` when dependencies are missing.
4. Run `npm run dev -- -H 127.0.0.1 -p 3001`, or use an available loopback port.
5. Open `http://127.0.0.1:3001/developer-preview`. Use Overview, Agents, Contacts, Campaigns, Calls, Analytics and Settings.
6. View the in-page operation audit log for synthetic interactions.

## Automated developer-preview browser check

Run only against a **verified, locally owned development** Next.js server. In PowerShell:

```powershell
$env:DEVELOPER_PREVIEW_E2E = "1"
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3001"
$env:PLAYWRIGHT_REUSE_EXISTING_SERVER = "true"
npx playwright test tests/e2e/developer-preview.spec.ts --workers=1
Remove-Item Env:DEVELOPER_PREVIEW_E2E
```

Stop if the dev server has not been verified or is using the wrong repository. The new test does not bypass authentication or test a live provider.

## Separately verify actual authenticated pages

With the existing **isolated local Supabase** service and synthetic fixtures, run the repo's established authenticated Playwright acceptance procedure. Check:

- Signup/login, valid and invalid credentials, logout, session persistence and protected routes.
- Organization onboarding and allowed role permissions.
- Organization switching and tenant isolation.
- Dashboard cards and all navigation links.
- Agents: create/edit/archive and governance controls.
- Contacts: create/edit/delete, search, consent filtering and CSV preview.
- Campaigns: create/edit, mock orchestration, simulation start/pause/resume/stop/reset, synthetic reporting.
- Existing calls, analytics and settings links: report missing routes or incomplete operations as failures rather than claiming they work.
- Every interactive control: visible, enabled when appropriate, valid outcome, failed outcome and no real outbound side effects.

Report each page/control as **passed, failed, skipped or not implemented**, with local screenshots and error logs. Never claim all buttons pass based on preview-only tests.

## Restrictions

Do not use real credentials in test artifacts. Do not invoke real calls, messages, provider APIs, LiveKit, paid models or production billing. Do not apply review-only migrations 012–016 or access remote Supabase. Preserve local uncommitted files. No automatic merge or deployment.

## Authenticated dashboard navigation hardening (pending rerun)

The real dashboard sidebar now links only to implemented destinations:
- Overview: `/dashboard`
- Agents: `/dashboard/agents`
- Contacts: `/dashboard/contacts`
- Campaigns: `/dashboard/campaigns`
- Call simulation and Simulation reports: `/dashboard/campaigns#simulation-studio`
- Settings: `/settings` (authenticated)

Standalone `/dashboard/calls` and `/dashboard/analytics` routes are **not implemented**; these names must not be represented as working full-featured pages. Simulated campaign reporting is available through the existing studio.

New `tests/e2e/dashboard-navigation.spec.ts` checks guest redirection, authenticated sidebar links, settings navigation, provider governance visibility, and the simulation-studio link. Run it using the established safe isolated-auth E2E runner in production mode. **Do not mark these latest changes PASS until the new tests run locally.**
