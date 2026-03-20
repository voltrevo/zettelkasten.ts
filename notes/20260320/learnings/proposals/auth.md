# Proposal: bearer token authentication

## Overview

The HTTP API gains two access tiers above unauthenticated reads, controlled
by bearer tokens. The CLI reads tokens from environment variables and forwards
them automatically.

---

## Access tiers

The hierarchy is strict: **admin ⊇ dev ⊇ unauthed**. A higher-tier token is
accepted anywhere a lower-tier token (or no token) is accepted.

### Unauthed — no token required

Truly public. Safe for corpus mirrors and anonymous consumers.

| Endpoint | |
|---|---|
| `GET /a/<hash>` | retrieve atom source |
| `GET /bundle/<hash>` | download ZIP bundle |
| `GET /search` | semantic search |
| `GET /relationships` | query relationship graph |

### Dev — `ZTS_DEV_TOKEN`

Everything unauthed, plus corpus writes and all goal agent-facing operations.
This is the token corpus-building agents receive.

| Endpoint | |
|---|---|
| `POST /a` | store atom |
| `DELETE /a/<hash>` | delete orphan atom |
| `POST /relationships` | add relationship (including test gate) |
| `DELETE /relationships` | remove relationship |
| `POST /describe` | set/update atom description |
| `GET /goals` | list goals |
| `GET /goals/<id>` | show goal + comments |
| `POST /goals/<id>/done` | mark goal done |
| `POST /goals/<id>/undone` | mark goal undone |
| `POST /goals/<id>/comments` | append comment |

### Admin — `ZTS_ADMIN_TOKEN`

Everything dev, plus goal management. Operators only; agents never receive
this token.

| Endpoint | |
|---|---|
| `POST /goals` | create goal |
| `PATCH /goals/<id>` | update goal (body, weight, name) |
| `DELETE /goals/<id>` | delete goal and its comments |

---

## Token configuration

Tokens are set as environment variables on the server process:

```sh
ZTS_DEV_TOKEN=<random string>    # required for corpus writes
ZTS_ADMIN_TOKEN=<random string>  # required for admin ops; also grants dev access
```

If a token env var is unset or empty, the server starts but rejects the
corresponding requests with 401. This means a server with no tokens configured
is read-only — a safe default for public corpus mirrors.

Tokens should be long random strings (32+ bytes, base64 or hex). No expiry
mechanism in v1 — rotate by restarting the server with a new value.

---

## Server enforcement

The server checks `Authorization: Bearer <token>` on every request and
resolves it to a tier (unauthed / dev / admin). Each endpoint declares its
minimum required tier. The check is:

```
request tier >= endpoint minimum tier  →  proceed
otherwise                              →  401 if no token, 403 if wrong tier
```

- Missing token on a dev/admin endpoint → `401 Unauthorized`
- Dev token on an admin endpoint → `403 Forbidden`
- Admin token anywhere → always accepted (admin ⊇ dev ⊇ unauthed)

---

## CLI configuration

The CLI reads tokens from the environment:

```sh
export ZTS_DEV_TOKEN=<token>     # set by operator in shell profile or .env
export ZTS_ADMIN_TOKEN=<token>   # set for admin operations
```

`zts` commands that require dev access automatically include
`Authorization: Bearer $ZTS_DEV_TOKEN`.
`zts admin` commands include `Authorization: Bearer $ZTS_ADMIN_TOKEN`.

If the required env var is unset, the CLI fails before making the request with
a clear error:

```
error: ZTS_DEV_TOKEN is not set. Export it to use write commands.
```

The agent workspace receives `ZTS_DEV_TOKEN` via the loop runner's environment.
It does not receive `ZTS_ADMIN_TOKEN`.

---

## Agent loop integration

`zts script worker` passes `ZTS_DEV_TOKEN` to the agent subprocess. The token
is sourced from the operator's environment when the loop is started:

```sh
ZTS_DEV_TOKEN=<token> zts script worker --channel bricklane | bash
```

The agent never sees `ZTS_ADMIN_TOKEN`. If an agent attempts an admin
operation, it receives a 403 and should surface this as a tooling gap rather
than trying to work around it.
