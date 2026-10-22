# Isolated LiveKit connectivity test (approval required before activation)

The one approved connectivity attempt was consumed on 2026-10-22. Do not
repeat a worker registration or room join under that approval. Its results,
including the unverified natural worker-disconnect event, are recorded in
[the Phase 3 readiness report](phase-3-readiness.md). A new external run
requires new explicit approval.

This procedure is prepared for a future browser and worker room-join test. It
does not exercise speech recognition, language models, speech synthesis, or
telephone calls. The current default is the local mock console; all external
activation flags remain `false`.

## Private configuration

Use a separate LiveKit project created and identified by the project owner.
Confirm its project hostname and API key in that project's dashboard. A matching
hostname alone cannot prove that the keys belong to an isolated project.

Copy [the test template](../.env.livekit-test.example) to a private
`.env.livekit-test.local` file at the repository root. The file is Git ignored.
Leave the normal `.env.local` untouched. It may point to a nonlocal Supabase
project; the isolated test launcher explicitly overlays values from the
private test file. Do not start ordinary `npm run dev` for this test.
The test requires:

| Variable | Purpose |
| --- | --- |
| `LIVEKIT_URL` | Isolated project's `wss://` origin, worker/server only |
| `NEXT_PUBLIC_LIVEKIT_URL` | Same `wss://` origin, safe to expose in the browser |
| `LIVEKIT_TEST_PROJECT_HOST` | Exact isolated project hostname |
| `LIVEKIT_API_KEY` | Isolated project API key, server/worker only |
| `LIVEKIT_API_SECRET` | Isolated project API secret, server/worker only |
| `VOICE_WORKER_SHARED_SECRET` | Separate random test-only HMAC secret, server/worker only |
| `VOICE_CONFIG_ENDPOINT` | Exact local backend route at `http://127.0.0.1:3001/api/internal/voice-agent/config` |

The test file must contain the **local** Supabase URL, anon key and service
role key from the isolated local stack. Load this file into the dedicated
Next.js process so it takes precedence over any normal `.env.local` values.
The service role key is used only by the server worker configuration route
after HMAC verification; it must never be used in client code. No production
Supabase project, account or contact data may be used for this test.

Before any external connection, run the offline-only preflight
`node scripts/check-livekit-test-config.mjs --verify-local-keys`. It reports only missing or
invalid variable names/conditions, never values. It requires **all** activation
flags to remain false. It also compares the private file's Supabase keys to
the local CLI status without printing them. Passing it validates local
configuration shape, not Cloud
project ownership, key validity or actual connectivity. The user must confirm
the URL and API credentials were copied from the newly created isolated
project in the LiveKit dashboard. Re-run the preflight after privately filling
the file, before requesting connection approval.
If only the three Supabase settings point at a nonlocal project, the local-only
`node scripts/sync-livekit-test-local-supabase.mjs` helper can replace those
settings with the local CLI status. It requires the private file to be Git
ignored and leaves LiveKit credentials and activation flags untouched.

The token route requires `LIVEKIT_URL` and `NEXT_PUBLIC_LIVEKIT_URL` to have
the same secure origin and checks the declared test hostname. It also requires
local Supabase and refuses connectivity mode in a production Next.js process.
The worker accepts only the fixed local configuration endpoint path. The
connectivity token lasts five minutes, is scoped to one organization/agent room,
and cannot publish audio or data. No SIP/telephony grant is issued. A signed
worker request also needs the matching five-minute, single-use room issuance
record created by that authenticated token request, plus a scoped agent lookup.
This local record is in-memory in one Next.js process; do not use it as a
production/multi-instance authorization store.

## Create the isolated project (no test connection yet)

1. In [LiveKit Cloud](https://cloud.livekit.io/), sign in and use the project
   selector to create a **new**, clearly named VoicePilot connectivity-test
   project. Do not choose an existing production/staging project.
2. Open that project's **Settings / Project Settings** and copy its secure
   WebSocket Project URL into both `LIVEKIT_URL` and
   `NEXT_PUBLIC_LIVEKIT_URL`. Enter only its hostname in
   `LIVEKIT_TEST_PROJECT_HOST`. The two URL origins must match.
3. Open the project's **Settings → Keys** (label may vary) and create a
   dedicated test API key and secret. Enter them privately as
   `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in the ignored test file.
4. Generate a separate random `VOICE_WORKER_SHARED_SECRET` for this test.
   Use local CLI Supabase **anon** and **service-role** keys only; they must
   come from the isolated local stack, never the existing remote project.
   Keep the worker endpoint at the exact local route in the template.
5. Keep `VOICE_CONNECTIVITY_TEST_ENABLED`, `VOICE_WORKER_ENABLED`,
   `VOICE_REALTIME_ENABLED` and `VOICE_OUTBOUND_ENABLED` all `false`, and
   `VOICE_PROVIDER_MODE=mock`. Do not start a worker, join a room, use a
   microphone, configure providers or enable telephony. Run the offline
   preflight and request explicit approval for the first connectivity test.

## Future manual activation sequence

These steps require a separate explicit approval for an external connection.

1. Start the isolated local Supabase stack and create disposable fixtures with
   two test users, two organizations and a test agent. Confirm the agent's ID
   and selected membership using the local fixture metadata; do not use a
   production account.
2. Fill the private `.env.livekit-test.local` from the isolated LiveKit project.
   Verify the server URL, browser URL and declared host match. Keep
   `VOICE_REALTIME_ENABLED=false`, `VOICE_OUTBOUND_ENABLED=false`, and
   `VOICE_PROVIDER_MODE=mock`.
3. After approval, set `VOICE_CONNECTIVITY_APPROVED_ONCE=true` only in the
   short-lived terminal processes. Leave all four flags in the private file
   `false`; the launchers enable only connectivity and worker flags in memory.
   Start a
   dedicated local Next.js process on port 3001 with
   `node scripts/run-isolated-livekit-next.mjs`. The launcher checks the private
   file and places its values above inherited environment variables.
4. For worker registration, set `VOICE_TEST_ENV_FILE` to the absolute private
   `.env.livekit-test.local` path in the worker's terminal (PowerShell:
   `$env:VOICE_TEST_ENV_FILE=(Resolve-Path .env.livekit-test.local).Path`) and
   run `python workers/voice-agent/run_worker.py dev`. The launcher reads that
   file in-process, validates the local configuration endpoint, then registers
   the connectivity-only worker. It does not initialize AI providers.
5. Sign in with the disposable local account, select the organization that owns
   the test agent, open `/dashboard/agents/test`, enter its agent ID, and use
   **Connect to LiveKit**. The browser receives a room token only after the
   server checks the current membership and agent ownership.

## Manual observation checklist

- Browser status changes from requesting to connected; the room is the expected
  `voicepilot:<organization UUID>:<agent UUID>:<session UUID>` room (Phase 3.12 format).
- Worker registration is visible in sanitized worker logs. The worker joins
  only after the signed configuration lookup verifies the room's agent and
  organization against a recent browser-issued room authorization. The
  authorization is local, five-minute, and single-use; it is not a production
  distributed authorization mechanism. The browser's remote participant count
  reflects the worker.
- No microphone prompt, published audio track, transcript of speech, provider
  request, SIP participant or outbound call appears in connectivity mode.
- End session disconnects the browser and clears its participant count.
- Record only sanitized connection state, room-scoped participant counts,
  worker registration/join, disconnect and recovery result. Do not record
  tokens, participant identities, configuration payloads or credentials.
- Closing the browser or losing the network produces a disconnect/error state;
  retry can use a fresh short-lived token.
- Disable both connectivity and worker flags, stop the two test processes, clean
  local fixtures and revoke the isolated test keys/shared secret after the test.

Record the first approved run as a short, sanitized checklist: browser
connection succeeded/failed, worker registration succeeded/failed, browser
remote participant count, disconnect behavior, and any recovery outcome. Do
not copy tokens, room participant identities, secrets or raw configuration into
the report. No entry in this checklist is considered passed before the room
has actually been joined after explicit approval.

The browser's **Session events** panel records connection events, not an AI
conversation transcript. A successful room join cannot establish STT, LLM,
TTS, voice quality, telephony or production readiness. Those need separate
implementation and approval. Production worker use also requires a shared
replay store, distributed rate limits, and a per-room authorization record;
the current local in-memory controls do not provide those guarantees.

## Phase 3.11 lifecycle update (local-only)

The worker now tracks the authenticated browser identity supplied by the
single-use, server-issued room authorization. A browser departure, including
an abrupt connection loss if delivered as `participant_disconnected`, requests
an idempotent shutdown. An unrelated participant departure does not. Room
disconnect, cancellation and an initial no-browser timeout also trigger
bounded room cleanup. The worker emits its disconnected success marker only
after cleanup succeeds; a cleanup failure is reported as a sanitized
`cleanup_failed` state. The browser awaits explicit disconnect and ignores
events from an old room/session.

These behaviors passed local mock tests, but a complete natural worker exit
has **not** been reverified against LiveKit Cloud. The 3.10B one-attempt
approval was consumed and its safeguard marker must remain. Do not execute
the launcher or join a room under that approval. If the user separately
approves another isolated connectivity-only test, observe both the browser
departure event and worker cleanup marker, plus a read-only zero-participant
check. Keep microphone publishing, AI providers and outbound calls disabled;
stop on any unexpected behavior without automatic retry.

## Phase 3.12 note — no renewed test approval

The current implementation uses a unique UUIDv4 room suffix and a single-use
tenant/user/session authorization record. The read-only cleanup helper now
requires the exact session room from a future approved run; it was not
executed in Phase 3.12 and is **not** evidence of a live cleanup check.
The worker has not connected with the new room format. Redis behavior was
mock-tested only, and production worker configuration remains fail-closed.
Do not start the worker, browser connectivity script or external room without
new explicit approval and a fresh isolated-test plan.
