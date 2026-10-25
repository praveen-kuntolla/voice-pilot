# Draft: Docker Desktop publishes Supabase local ports on all interfaces

**Status:** Prepared for user review. Do not publish without approval.

## Summary

On Windows with Docker Desktop Linux containers, Supabase CLI `2.122.0` starts
the local stack with wildcard host-port bindings even when it is given a custom
bridge network whose `host_binding_ipv4` default is `127.0.0.1`.

This is intended as a Windows reproduction to add to the existing Docker
Desktop report rather than a claim that the network option is unsupported by
Docker Engine generally.

## Environment

| Component | Version / value |
| --- | --- |
| Host OS | Windows 10 Pro, build 26220 |
| Docker Desktop | 4.96.3 |
| Docker Engine | 29.9.2 |
| Docker context | `desktop-linux` |
| Supabase CLI | 2.122.0 (project-local dependency) |
| Container mode | Linux containers / WSL2 backend |
| Supabase project ID | `voicepilot-ai` (local only) |

No remote Supabase project, credential, API key, connection string, or
application record is involved in this reproduction.

## Reproduction

1. Create a custom Docker bridge network with a loopback default for published
   ports:

   ```powershell
   docker network create --driver bridge `
     --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 `
     voicepilot_loopback
   ```

2. Confirm the network option:

   ```powershell
   docker network inspect voicepilot_loopback
   ```

   Relevant sanitized result:

   ```text
   com.docker.network.bridge.host_binding_ipv4=127.0.0.1
   com.docker.network.enable_ipv4=true
   com.docker.network.enable_ipv6=false
   ```

3. Start the local stack on that network:

   ```powershell
   npx supabase start --network-id voicepilot_loopback
   ```

4. Inspect the published ports and the Docker port bindings:

   ```powershell
   docker ps --format "table {{.Names}}\t{{.Ports}}"
   docker inspect supabase_kong_voicepilot-ai
   ```

## Expected behavior

The documented custom network should cause local Supabase's explicitly
published host ports to bind only to `127.0.0.1` (and, where applicable, `::1`).
The API, database, Studio, Mailpit, and Analytics services should not be
reachable from non-loopback network interfaces.

## Actual behavior

The custom network retains its loopback option, but Supabase-created containers
have empty Docker `HostIp` fields. Docker Desktop publishes the ports on every
interface instead:

| Local service | Published binding observed |
| --- | --- |
| API gateway | `0.0.0.0:54321` and `[::]:54321` |
| PostgreSQL | `0.0.0.0:54322` and `[::]:54322` |
| Studio | `0.0.0.0:54323` and `[::]:54323` |
| Mailpit | `0.0.0.0:54324` and `[::]:54324` |
| Analytics | `0.0.0.0:54327` and `[::]:54327` |

Example sanitized inspect output:

```json
{
  "8000/tcp": [{ "HostIp": "", "HostPort": "54321" }]
}
```

The result is the same after upgrading the project-local CLI from `2.121.0` to
`2.122.0`. The `supabase start --help` output offers `--network-id`, but no
supported option for an explicit published host IP.

## Security impact

The local stack's database and development services may be accessible to other
devices on the local network. This is contrary to the purpose of the loopback
network mitigation and blocks a security-sensitive local test environment from
being considered isolated.

## Related reports

- Supabase CLI issue #1397 describes the original request and recommends the
  custom-network approach.
- Supabase issue #51027 reports the same approach failing under Docker Desktop
  on macOS and identifies Docker Desktop's global “localhost by default” port
  binding preference as a manual workaround.

This report should preferably be added as a Windows/Docker Desktop 4.96.3
reproduction comment on issue #51027. If maintainers consider Windows behavior
meaningfully distinct, this draft can instead become a new CLI issue referencing
both reports.

## Requested resolution

1. Document whether `--network-id` is expected to control host port binding on
   Docker Desktop for Windows and macOS.
2. Provide a supported, persistent Supabase CLI configuration or flag to set
   the Docker `HostIp` for all local-stack published ports explicitly.
3. If Docker Desktop's global port-binding setting is the only supported route,
   have the CLI detect wildcard bindings after startup and issue a visible
   security warning.

## Separate Vector restart observation

This is not asserted to be caused by the port-binding issue. The local Vector
container repeatedly restarts after reporting that its Docker log source cannot
connect to Docker Desktop's internal endpoint at `192.168.65.254:2375`
(`connection refused`). Other core containers remain running. No change was
made to Vector, Docker Desktop, container definitions, networks, volumes, or
firewall settings. A separate diagnostic report should include only sanitized
container logs and Docker Desktop version details.

## Local project status

No migration was applied. No database reset was performed. The existing
PostgreSQL volume was preserved. The currently mounted local database has no
application schema or Supabase migration ledger, so no prior local migrations
can be treated as applied until the local-environment isolation issue is
resolved and the state is intentionally revalidated.
