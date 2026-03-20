# Proposal: Docker deployment design

## Reference

`reference/claude-sandbox/` contains a working two-container Claude Code
sandbox (sandbox + Squid gateway) that this design adapts. Read it for
implementation patterns: iptables-free network isolation via Docker
`internal: true`, Squid domain allowlist, entrypoint patterns, volume
layout. Note the issues documented in `reference/claude-sandbox/ISSUES.md`
— avoid repeating them here.

---

## Overview

Four containers, one compose file:

```
Internet
  │
  ▼
[gateway]  ← Squid proxy, domain allowlist
  │  internal network only
  ├──────────────────────────┐
  │                          │
[agent]              [zts-server]
  │                      │
  │                  [checker]
  │                      │
  │              (internal only,
  │               no gateway)
  └──────────────────────────┘
         zts-net (internal: true)
```

- **gateway** — Squid forward proxy. Agent traffic exits through here.
  Allowlist: `api.anthropic.com`. zts-server and checker have no gateway
  access — they are internal-only.
- **zts-server** *(authoritative archive)* — HTTP API on port 8000. Corpus
  files + SQLite volume. Never executes atom code. Delegates all test
  execution to checker.
- **checker** *(evaluation chamber)* — Minimal Deno container. Runs
  TypeScript tests only. No arbitrary system interaction. No external
  network. Strong resource limits (CPU, wall-clock time, memory). Fetches
  atoms via HTTP from zts-server. Its results are authoritative — the only
  source of truth for test outcomes that affect corpus state.
- **agent** *(research lab)* — Claude Code + zts CLI. Executes arbitrary
  code, can mutate its environment freely, ephemeral and replaceable.
  Restricted outbound: zts-server + model API only (via gateway). No corpus
  filesystem access. Dev token only. Principle: unsafe locally, safe
  externally.

---

## Networks

```yaml
networks:
  zts-net:
    internal: true    # no direct internet; all egress via gateway
    driver: bridge
    ipam:
      config:
        - subnet: 172.29.0.0/24
  gateway-egress:
    driver: bridge    # gateway's external-facing leg
```

| Container  | Networks              | Can reach              |
|---         |---                    |---                     |
| gateway    | zts-net, gateway-egress | zts-net peers + internet (allowlisted) |
| zts-server | zts-net               | checker, agent (inbound only) |
| checker    | zts-net               | zts-server only         |
| agent      | zts-net               | zts-server, gateway     |

---

## Container: zts-server

- Runs the zts Deno server (`deno task zts run`)
- Mounts two named volumes:
  - `corpus` → `~/.local/share/zettelkasten/` (git repo + SQLite)
  - `server-log` → server.log
- Exposes port 8000 on zts-net (not to host by default; operator can
  expose for direct access)
- Environment:
  - `ZTS_DEV_TOKEN`
  - `ZTS_ADMIN_TOKEN`
  - `ZTS_CHECKER_URL=http://checker:8001` (internal)
- Never touches atom execution; delegates all test verification to checker
  via `POST http://checker:8001/check`

---

## Container: checker

Minimal. Only purpose: run Deno test subprocesses and return results.

**What it runs:** a small HTTP server (itself a Deno process) that accepts:

```
POST /check
Content-Type: application/json

{
  "testHashes": ["<hash1>", "<hash2>"],
  "targetHash": "<hash>",         // for registered relationship verification
  "targetSource": "<ts source>"   // for pre-commit test gate (atom not yet stored)
}
→ { "pass": true, "output": "..." }
```

For each test hash, the checker spawns:

```sh
deno test \
  --allow-import=http://zts-server:8000 \
  test-runner.ts <test-hash> <target-hash-or-tempfile>
```

When `targetSource` is provided (pre-commit), the checker writes it to a
temp file and the test runner imports it directly (by file path, not
server URL). The temp file is deleted after the subprocess exits.

**Isolation:** checker has no gateway access. Its only outbound connection
is `http://zts-server:8000` for atom imports. It has no corpus volume
mount — atoms come in over HTTP.

**Resource limits** (enforced at both the Docker and subprocess level):
- Wall-clock timeout per test run: 30s (configurable via `ZTS_TEST_TIMEOUT`)
- Memory limit per subprocess: 256 MB
- CPU: limited to prevent a runaway test from starving other checker work

These limits are adversarial — test atoms are untrusted code. The checker
treats every execution as potentially hostile.

**Image:** minimal Deno image. No Claude Code, no SSH, no dev tools.

---

## Container: agent

Based on `reference/claude-sandbox/` with these changes:

- **No SSH / frp.** The agent runs autonomously via `zts script worker`.
  Operator interaction is through `docker compose logs` and admin CLI
  commands, not SSH.
- **Deno installed** (replacing Node/Python/etc. — atoms are TypeScript).
- **zts CLI installed** (`deno install` or compiled binary).
- **No corpus volume.** The agent cannot see `~/.local/share/zettelkasten/`.
  All corpus access is via HTTP to zts-server.
- **Workspace volume:** `agent-workspace` → `/home/claude/workspace`.
  Each channel gets a subdirectory: `workspace/<channel>/`.
- **Environment:**
  - `ZTS_SERVER_URL=http://zts-server:8000`
  - `ZTS_DEV_TOKEN` (not admin)
  - `ZTS_CHANNELS=bricklane,starling` (comma-separated list)
  - `ANTHROPIC_API_KEY` or credentials file (for Claude Code)
  - `http_proxy` / `https_proxy` pointing to gateway (for Anthropic API)
- **Entrypoint:** reads `ZTS_CHANNELS`, spawns one `zts script worker
  --channel <name> | bash` process per channel, all in parallel. Waits
  for all; restarts any that exit non-zero after a backoff.

Example entrypoint logic:

```sh
IFS=',' read -ra CHANNELS <<< "${ZTS_CHANNELS:-default}"
for channel in "${CHANNELS[@]}"; do
  zts script worker --channel "$channel" | bash &
done
wait
```

Each channel loop writes to `workspace/<channel>/` and logs independently.
Claude Code sessions for different channels are fully independent — separate
handover files, separate iteration counts, separate `ZTS_CHANNEL` env vars.

The agent's Deno subprocess (for `zts exec`) also routes imports through
`http://zts-server:8000`, constrained by the same network rules.

**Gateway allowlist for agent:**
- `api.anthropic.com` — Claude Code API
- Nothing else. The agent has no reason to reach npm, GitHub, or package
  registries — everything it needs is in the corpus or the zts CLI.

---

## Pre-commit test gate flow

The test gate in `POST /a -t <hashes>` needs to run tests against an atom
that is not yet in the corpus. Flow:

1. CLI sends `POST /a` with atom source in body and `X-Require-Tests` header
2. Server receives the source, does structural validation (export count,
   import paths, size limit)
3. Server calls `POST http://checker:8001/check` with:
   - `testHashes`: the hashes from `X-Require-Tests`
   - `targetSource`: the raw atom source from the request body
4. Checker writes source to tempfile, runs test subprocesses, returns result
5. If pass: server commits atom to corpus, registers test relationships,
   returns 201
6. If fail: server returns 422 with checker output; nothing committed

This keeps the trust model clean: the server is the authority, checker is
the executor, the CLI never self-certifies test results.

---

## Volumes

```yaml
volumes:
  corpus:           # zts-server only: git repo + SQLite
  server-log:       # zts-server only: append-only log
  agent-workspace:  # agent only: handovers, notes, tmp
```

No volume is shared between containers. The corpus is zts-server's private
storage.

---

## Known issues to avoid (from reference/claude-sandbox/ISSUES.md)

- Use a guard in entrypoint to avoid appending proxy env to `.bashrc` on
  every restart (or write to a separate sourced file)
- Add `.dockerignore` for all containers
- Add healthchecks (especially: agent waits for zts-server ready, checker
  waits for network)
- Use bind-mount only (not COPY) for any config that needs live updates
- Don't claim iptables enforcement unless the entrypoint actually sets rules;
  rely on Docker `internal: true` and document it honestly

---

## Compose sketch

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
    depends_on: [gateway, checker]
    environment:
      - ZTS_DEV_TOKEN
      - ZTS_ADMIN_TOKEN
      - ZTS_CHECKER_URL=http://checker:8001
    volumes:
      - corpus:/root/.local/share/zettelkasten
      - server-log:/var/log/zts
    networks: [zts-net]

  checker:
    build: ./docker/checker
    restart: unless-stopped
    environment:
      - ZTS_SERVER_URL=http://zts-server:8000
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
  corpus:
  server-log:
  agent-workspace:
```
