# Docker Deployment

Five containers on an internal network. The agent container is a sandbox for
running autonomous Claude Code agents against the corpus.

## Quick Start

```sh
cd docker

# Start infrastructure (server, checker, ollama, gateway)
docker compose up -d

# Pull the embedding model (first time only)
docker exec ollama ollama pull nomic-embed-text

# Note the generated tokens from server logs
docker logs zts-server 2>&1 | head -10

# Copy the dev token to .env
cp .env.example .env
# Edit .env — set ZTS_DEV_TOKEN from the server logs

# Restart agent to pick up the token
docker compose up -d zts-agent

# Shell into the agent
docker exec -it zts-agent bash

# Inside the agent container:
claude                          # authenticate with Anthropic (interactive)
zts recent                      # verify server connectivity
zts worker setup                # create workspace
zts worker run --model haiku --dangerously-skip-permissions
```

## Architecture

```
Internet
  │
  ▼
┌──────────┐
│ gateway  │  Squid proxy — allowlist: *.anthropic.com, *.claude.ai,
│ :3128    │  *.claude.com, Debian repos
└────┬─────┘
     │
     │  zts-net (internal Docker network)
     │
┌────┴─────┐   ┌──────────────┐   ┌──────────┐
│zts-server│◄──│ zts-checker  │   │  ollama  │
│ :7483    │   │ :7484        │   │ :11434   │
└────┬─────┘   └──────────────┘   └──────────┘
     │
┌────┴─────┐
│zts-agent │  Claude Code + zts CLI
│          │  Routes API calls through gateway
└──────────┘
```

**Ports:** 7483 (server), 7484 (checker) — ZTS on a phone keypad.

## Containers

| Container | Purpose | Internet | Volumes |
|-----------|---------|----------|---------|
| zts-server | API + web UI | Host access only (port 7483) | `zts-data` (SQLite + config) |
| zts-checker | Sandboxed test execution | None | None |
| ollama | Embedding model (nomic-embed-text) | Egress (model pulls) | `ollama-models` |
| gateway | Squid proxy with allowlist | Yes | None |
| zts-agent | Agent sandbox (Claude Code + zts) | Via gateway only | `agent-workspace` |

## Configuration

The server auto-generates `config.json5` with random tokens on first start.
Tokens are printed to stdout. The agent only needs the dev token (no admin
access).

- **Server config**: auto-generated at `/data/config.json5` inside the container
- **Agent config**: auto-generated from `ZTS_DEV_TOKEN` env var
- **Checker config**: embedded in image (just the port number)

## Web UI

Accessible at http://localhost:7483. Log in with the admin token from the
server logs.

## Useful Commands

```sh
# View server logs
docker logs -f zts-server

# View checker logs
docker logs -f zts-checker

# Shell into agent
docker exec -it zts-agent bash

# Run a zts command in the agent
docker exec zts-agent zts recent

# Stop everything
docker compose down

# Rebuild after code changes
docker compose build
docker compose up -d
```

## GPU Support (Ollama)

To enable GPU acceleration for embeddings, add to `docker-compose.yml` under
the `ollama` service:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```
