# Deployment

## Auth

Bearer tokens, three tiers. The hierarchy is strict: admin >= dev >= unauthed.

### Tiers

**Unauthed** — no token. Read-only access.

| Endpoint             |                               |
| -------------------- | ----------------------------- |
| `GET /a/<hash>`      | retrieve atom source          |
| `GET /bundle/<hash>` | ZIP of atom + transitive deps |
| `GET /search`        | semantic + FTS5 search        |
| `GET /list`          | enumerate atoms               |
| `GET /relationships` | query graph                   |
| `GET /tops/<hash>`   | supersedes navigation         |
| `GET /status`        | corpus health summary         |

**Dev** — `ZTS_DEV_TOKEN`. Everything unauthed, plus corpus writes and
agent-facing goal operations.

| Endpoint                 |                                         |
| ------------------------ | --------------------------------------- |
| `POST /a`                | store atom                              |
| `DELETE /a/<hash>`       | delete orphan                           |
| `POST /relationships`    | add relationship                        |
| `DELETE /relationships`  | remove relationship                     |
| `POST /describe/<hash>`  | set/update description                  |
| `POST /test-evaluation`  | set eval metadata                       |
| `PATCH /test-evaluation` | update commentary                       |
| `GET /properties`        | query properties                        |
| `POST /properties`       | set property (non-admin keys)           |
| `DELETE /properties`     | remove property (non-admin keys)        |
| Goal agent endpoints     | pick, show, list, done, undone, comment |

**Admin** — `ZTS_ADMIN_TOKEN`. Everything dev, plus goal management.

| Endpoint                          |                                            |
| --------------------------------- | ------------------------------------------ |
| `POST /goals`                     | create goal                                |
| `PATCH /goals/<id>`               | update body, weight                        |
| `DELETE /goals/<id>`              | delete goal + comments                     |
| `POST /properties` (admin keys)   | set admin-only properties (e.g. `starred`) |
| `DELETE /properties` (admin keys) | remove admin-only properties               |

### Configuration

Tokens are environment variables on the server:

```sh
ZTS_DEV_TOKEN=<random 32+ bytes>    # required for writes
ZTS_ADMIN_TOKEN=<random 32+ bytes>  # required for admin; also grants dev
```

No tokens configured = read-only server. Safe default for corpus mirrors.

The CLI reads `ZTS_DEV_TOKEN` / `ZTS_ADMIN_TOKEN` from env and includes
`Authorization: Bearer <token>` automatically. Missing token on a write command
= client-side error before the request is sent.

---

## Docker

Reference implementation:
[../learnings/reference/claude-sandbox/](../learnings/reference/claude-sandbox/)
— working Squid gateway + Ubuntu sandbox with `internal: true` network
isolation. Read its ISSUES.md before building the zts containers.

Four containers, one compose file.

```
Internet
  |
  v
[gateway]       Squid proxy — allowlist: api.anthropic.com only
  |
  |  (zts-net: internal Docker network)
  |
  +-- [zts-server]   Corpus + API. Never executes atom code.
  |       |
  |   [checker]      Runs tests only. No internet. Resource-limited.
  |
  +-- [agent]        Claude Code + zts CLI. N channels.
                     Unsafe locally, safe externally.
```

### Networks

```yaml
networks:
  zts-net:
    internal: true # no direct internet
    driver: bridge
    ipam:
      config:
        - subnet: 172.29.0.0/24
  gateway-egress:
    driver: bridge # gateway's external-facing leg
```

| Container  | Networks                | Can reach                            |
| ---------- | ----------------------- | ------------------------------------ |
| gateway    | zts-net, gateway-egress | zts-net peers + allowlisted internet |
| zts-server | zts-net                 | checker, agent (inbound only)        |
| checker    | zts-net                 | zts-server only                      |
| agent      | zts-net                 | zts-server, gateway                  |

### Container: gateway

Squid forward proxy. Domain allowlist: `api.anthropic.com`. The server and
checker have no gateway access — internal only.

### Container: zts-server

Runs the Deno HTTP server and Ollama. Stores `zts.db` on a named volume. Ollama
runs alongside the Deno process for embedding generation (semantic search, atom
post/describe). Never executes atom code — delegates all test execution to
checker via `POST http://checker:8001/check`.

Serves the web UI at `/ui/` — static HTML/JS/CSS bundled into the server or
served from a configurable directory.

Environment: `ZTS_DEV_TOKEN`, `ZTS_ADMIN_TOKEN`, `ZTS_CHECKER_URL`,
`OLLAMA_MODEL` (default: `nomic-embed-text`).

### Container: checker

Minimal Deno image. HTTP server accepting test execution requests. For each
test, spawns:

```sh
deno test --allow-import=http://zts-server:8000 test-runner.ts <test> <target>
```

No internet. No corpus volume. Resource limits: 30s wall-clock (configurable via
`ZTS_TEST_TIMEOUT`), 256MB memory per subprocess. Treats every execution as
potentially adversarial.

For pre-commit test gates (`POST /a -t <hashes>`), the server sends the atom
source to the checker, which writes it to a temp file for the test subprocess to
import directly (atom not yet in corpus).

### Container: agent

Ubuntu + Deno + Claude Code + zts CLI. No corpus volume — all corpus access via
HTTP to zts-server. Receives `ZTS_DEV_TOKEN` only (never admin).

Outbound: zts-server + Anthropic API (via gateway). Nothing else.

Entrypoint reads `ZTS_CHANNELS`, spawns one `zts script worker` per channel in
parallel:

```sh
IFS=',' read -ra CHANNELS <<< "${ZTS_CHANNELS:-default}"
for channel in "${CHANNELS[@]}"; do
  zts script worker --channel "$channel" | bash &
done
wait
```

### Volumes

```yaml
volumes:
  zts-data: # zts-server only: zts.db + ollama models
  agent-workspace: # agent only: handovers, notes, tmp
```

No volume is shared between containers.

### Compose sketch

```yaml
services:
  gateway:
    build: ./docker/gateway
    restart: unless-stopped
    networks:
      zts-net:
        ipv4_address: 172.29.0.2
      gateway-egress:

  zts-server:
    build: ./docker/server
    restart: unless-stopped
    depends_on: [checker]
    environment:
      - ZTS_DEV_TOKEN
      - ZTS_ADMIN_TOKEN
      - ZTS_CHECKER_URL=http://checker:8001
    volumes:
      - zts-data:/data
    networks: [zts-net]

  checker:
    build: ./docker/checker
    restart: unless-stopped
    environment:
      - ZTS_SERVER_URL=http://zts-server:8000
      - ZTS_TEST_TIMEOUT=${ZTS_TEST_TIMEOUT:-30}
    networks: [zts-net]

  agent:
    build: ./docker/agent
    restart: unless-stopped
    depends_on: [zts-server, gateway]
    environment:
      - ZTS_SERVER_URL=http://zts-server:8000
      - ZTS_DEV_TOKEN
      - ZTS_CHANNELS=${ZTS_CHANNELS:-default}
      - ANTHROPIC_API_KEY
      - GATEWAY_IP=172.29.0.2
      - GATEWAY_PORT=3128
    volumes:
      - agent-workspace:/home/claude/workspace
    networks: [zts-net]

networks:
  zts-net:
    internal: true
    driver: bridge
    ipam:
      config:
        - subnet: 172.29.0.0/24
  gateway-egress:
    driver: bridge

volumes:
  zts-data:
  agent-workspace:
```

---

## Subprocess execution boundary

**The server never executes corpus code.** It stores, validates, retrieves,
searches, and manages relationships. No atom import, no eval, no dynamic
execution.

**The CLI never evaluates corpus code in its own process.** `zts exec` and
`zts test` spawn isolated Deno subprocesses with inherited stdio.

```
CLI process (HTTP only)
  |  spawns subprocess
  v
deno run --allow-import=<server> [--allow-net] [--allow-read] run.ts <hash> [args...]
```

The subprocess's stdio is inherited — TTY detection, signals, piping all work
correctly. The CLI waits for exit and forwards the exit code.

| Component                   | Executes corpus code?                              |
| --------------------------- | -------------------------------------------------- |
| zts server                  | Never                                              |
| zts CLI process             | Never                                              |
| `run.ts` subprocess         | Yes — the only execution context                   |
| `test-runner.ts` subprocess | Yes — isolated, import-only permissions            |
| checker container           | Yes — via test-runner subprocess, resource-limited |

---

## Agent loop runner

### `zts script worker`

Emits a shell script to stdout. The operator pipes it to bash:

```sh
zts script worker --channel bricklane | bash
zts script worker --channel bricklane --max-turns 80 | bash
zts script worker --once | bash   # single iteration
```

The emitted script:

1. Resolves data dir, creates channel directories
2. Initializes `handovers/current.md` if first run
3. Enters iteration loop:
   - Snapshots `current.md`, removes `next.md`
   - Invokes `claude` with `zts script context` + `zts script iteration`
   - After exit: promotes `next.md` to `current.md` (or warns if absent)
   - Backs off 30s on non-zero exit

### `zts script context` / `zts script iteration`

Emit prompt fragments. Ship with the tool — no loose files to maintain.

```sh
# Inspect:
zts script context
zts script iteration

# Customize:
zts script context > my-context.md && $EDITOR my-context.md
```

### `zts script setup`

Initializes a workspace directory:

```
workspace/
  notes/current.md        -- rolling focus, orientation
  handovers/current.md    -- seeded with first-run content
  logs/
  tmp/
```

### Environment exposed to agent

```sh
ZTS_CHANNEL=<name>
ZTS_HANDOVER_DIR=<path>
ZTS_SERVER_URL=http://zts-server:8000
ZTS_DEV_TOKEN=<token>
```

No corpus paths. No SQLite paths. No zts source paths.
