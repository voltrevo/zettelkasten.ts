# Known Issues

## Critical

### Missing domains in allowlist

[gateway/allowed_domains.txt](gateway/allowed_domains.txt) only includes
Anthropic and Ubuntu/Debian repos. Domains for PyPI, npm, crates.io, Go proxy,
and GitHub are missing, so most package installs will fail out of the box.

### Remove API key / credentials config

`ANTHROPIC_API_KEY` and `CREDENTIALS_FILE` references should be removed from
[.env.example](.env.example), [README.md](README.md), and
[docker-compose.yml](docker-compose.yml). Users should authenticate
interactively inside the container using Claude Code's built-in login flow
instead of injecting credentials via environment variables.

## Moderate

### `.bashrc` appended on every restart

[entrypoint.sh](entrypoint.sh) unconditionally appends proxy environment
variables to `~/.bashrc`. Since the home directory is a persistent volume, each
container restart adds duplicate lines. Should use a guard or write to a
separate sourced file.

### README describes iptables enforcement that doesn't exist

The [README](README.md) states that iptables blocks direct outbound traffic and
that `NET_ADMIN` is required, but [entrypoint.sh](entrypoint.sh) has no iptables
rules and [docker-compose.yml](docker-compose.yml) doesn't grant `NET_ADMIN`.
Network isolation actually relies on Docker's `internal: true` network setting.

### README incorrectly attributes frpc to sandbox container

[README.md](README.md) describes the sandbox as having frpc, but frpc is
installed and run in the gateway container
([gateway/Dockerfile](gateway/Dockerfile),
[gateway/gateway-entrypoint.sh](gateway/gateway-entrypoint.sh)).

### Allowlist baked into gateway image unnecessarily

The gateway Dockerfile COPYs `allowed_domains.txt` into the image, but
[docker-compose.yml](docker-compose.yml) also bind-mounts it at runtime. The
COPY is redundant — relying solely on the bind mount would allow live updates
via [reload-gateway.sh](reload-gateway.sh) without rebuilding the image.

### No `.dockerignore`

The build context sends `.git`, `local/`, README, and other unnecessary files to
the Docker daemon. A `.dockerignore` would speed up builds and reduce context
size.

## Minor

### No healthchecks

Neither service in [docker-compose.yml](docker-compose.yml) defines a
`healthcheck`. The sandbox starts as soon as the gateway container is up, not
when Squid is actually ready to accept connections.

### DNS resolution on internal network

`sandbox-net` is `internal: true`. The gateway entrypoint uses
`SANDBOX_HOST=sandbox` for frpc's `localIP`, which depends on Docker DNS working
on the internal network. Worth verifying this resolves correctly.
