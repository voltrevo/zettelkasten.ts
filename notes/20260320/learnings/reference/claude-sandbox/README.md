# Claude Sandbox

Isolated Docker environment for running Claude Code autonomously.
Network-restricted to package registries, GitHub, and the Anthropic API. Public
SSH access via [frp](https://github.com/fatedier/frp) reverse proxy.

See [ISSUES.md](ISSUES.md) for known issues and [PROPOSALS.md](PROPOSALS.md) for
future improvement ideas.

## Architecture

```
Internet ──► frp server ──► sandbox:22 (SSH)
                               │
                               ├── Claude Code (all permissions pre-approved)
                               ├── Python, Node, Go, Rust, C/C++
                               └── iptables firewall
                                      │
                                      ▼
                               gateway:3128 (Squid proxy)
                                      │
                                      ▼
                              Allowlisted domains only:
                                - api.anthropic.com
                                - github.com
                                - pypi.org, npmjs.org, crates.io, ...
                                - ubuntu/debian repos
```

**Two containers:**

- **gateway** — Squid forward proxy with a domain allowlist. All sandbox traffic
  routes through here.
- **sandbox** — Ubuntu 24.04 with dev tools, Claude Code, SSH, frpc. iptables
  restricts outbound to only the gateway and frp server.

## Quick Start

```bash
# 1. Configure
cp .env.example .env
vim .env  # fill in API key, SSH key, frp details

# 2. Build and run
docker compose up -d --build

# 3. Connect
ssh claude@<your-frp-server> -p <FRP_REMOTE_PORT>

# 4. Start Claude Code inside the sandbox
claude
```

## Parameters

| Variable              | Required | Default      | Description                                   |
| --------------------- | -------- | ------------ | --------------------------------------------- |
| `ANTHROPIC_API_KEY`   | *        | —            | Anthropic API key                             |
| `CREDENTIALS_FILE`    | *        | —            | Host path to `.credentials.json` (Claude Max) |
| `SSH_AUTHORIZED_KEYS` | yes      | —            | SSH public key(s) for login                   |
| `FRP_SERVER_ADDR`     | yes      | —            | frp server hostname/IP                        |
| `FRP_AUTH_TOKEN`      | yes      | —            | frp auth token                                |
| `FRP_REMOTE_PORT`     | yes      | —            | Remote port on frp server for SSH             |
| `FRP_SERVER_PORT`     | no       | `7000`       | frp server control port                       |
| `GATEWAY_IP`          | no       | `172.28.0.2` | Proxy container IP                            |
| `GATEWAY_PORT`        | no       | `3128`       | Proxy listen port                             |

\* One of `ANTHROPIC_API_KEY` or `CREDENTIALS_FILE` is required.

## Claude Max (Credentials File)

If you have a Claude Max subscription instead of an API key, point
`CREDENTIALS_FILE` at your credentials JSON:

```bash
# In .env, comment out ANTHROPIC_API_KEY and set:
CREDENTIALS_FILE=/home/you/.claude/.credentials.json
```

The file is bind-mounted read-only and copied into the container at startup. No
extra compose flags needed.

## Running Multiple Instances

Use unique `FRP_REMOTE_PORT` values and container names:

```bash
FRP_REMOTE_PORT=6001 docker compose -p sandbox-2 up -d --build
```

## Customizing the Domain Allowlist

Edit [gateway/allowed_domains.txt](gateway/allowed_domains.txt) and rebuild the
gateway:

```bash
docker compose up -d --build gateway
```

## Persistent Data

Three named volumes preserve state across restarts:

- `workspace` — `/home/claude/workspace` (projects)
- `claude-config` — `/home/claude/.claude` (Claude Code config/history)
- `ssh-host-keys` — `/etc/ssh` (stable host keys)

## frp Server Setup

You need a publicly reachable frp server. Minimal `frps.toml`:

```toml
bindPort = 7000
auth.method = "token"
auth.token = "your-frp-token-here"
```

Run it: `frps -c frps.toml`

## Security Notes

- Password auth is disabled; SSH is key-only.
- Root login is disabled; the `claude` user has passwordless sudo.
- The sandbox cannot reach arbitrary internet hosts — only allowlisted domains
  via the proxy.
- iptables inside the container block direct outbound, forcing all traffic
  through Squid.
- The container requires `NET_ADMIN` capability for iptables.
