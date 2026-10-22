# Isolated local Supabase E2E setup

The repository is prepared for local Supabase testing, but this environment currently cannot start it: Docker Desktop's daemon is unavailable and the Supabase CLI is not installed.

After approval, start Docker Desktop, install the official Supabase CLI, run `supabase start` from this repository, and verify the API URL is local (`http://127.0.0.1:54321` or equivalent). Apply migrations only to that local instance. Never link the production project or use production credentials.

Test fixtures must reject URLs containing `.supabase.co` and reject the production project reference `xegmtbkxcynxpioifdxh`. Use only local CLI keys in a temporary ignored test environment. Run RLS and Playwright tests, then stop the local instance.

## Verified local run

On 2026-10-22, Docker Engine 29.9.1 and Supabase CLI 2.121.0 were verified. The local stack used project ID `voicepilot-ai` and API URL `http://127.0.0.1:54321`; remote link metadata was removed before fixture creation. Migrations 001 through 006 applied successfully to the local database.

The disposable fixture harness created two local Auth users, two organizations, memberships, agents, a contact and a draft campaign. The PostgreSQL RLS test verified valid multi-membership access plus cross-tenant denial for agents, contacts and campaigns. Fixtures and the temporary local environment file were removed after testing.

Authenticated Playwright ran against a separate local Next.js server and passed all 8 tests, including login, protected redirects, organization switching, tenant-scoped agent visibility, microphone denial, mock voice lifecycle, CSV preview, and LiveKit-disabled protection. No LiveKit or provider connection was attempted.
