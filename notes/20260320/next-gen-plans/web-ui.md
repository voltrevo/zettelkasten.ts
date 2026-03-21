# Web UI

Served by zts-server at `/ui/`. No separate frontend container — the UI is
static HTML/JS/CSS served by the same Deno process that handles the API. Admin
token required for admin operations; dev token for write operations; read-only
views work unauthenticated.

Ollama runs in the zts-server container alongside the Deno process, providing
embedding generation for semantic search.

---

## Auth in the browser

Login screen accepts a bearer token (admin or dev). Stored in a session cookie
or localStorage. The UI includes it as `Authorization: Bearer <token>` on all
API requests. Read-only views (corpus browser, search, status) work without
login.

The token tier determines what the UI exposes:

- **No token**: browse, search, view atoms and relationships
- **Dev**: everything above, plus describe, relate, mark done/undone, comment
- **Admin**: everything above, plus goal CRUD, weight editing

---

## Pages

### Dashboard (`/ui/`)

The landing page. Live version of `zts status`:

- Corpus totals: atom count, defect count, superseded count
- Starred atoms: operator-curated highlights, always visible
- Recent activity sparkline or bar (atoms posted per day, last 30d)
- Active goals with atom counts and recent contribution rates
- Defects list (expandable)
- Recent log entries (last 20 write operations)

Auto-refreshes on a reasonable interval (30s). Gives an operator an at-a-glance
picture without touching the CLI.

### Corpus browser (`/ui/atoms`)

Paginated atom list. Columns: hash (truncated, links to detail), description
(first line), goal tag, gzip size, created date. Sortable by date and size.

Filters:

- Text search (description embeddings)
- Code search (FTS5 on source)
- Goal dropdown
- Starred only toggle
- Broken only toggle
- Superseded only toggle

Clicking an atom opens the detail view.

### Atom detail (`/ui/atoms/<hash>`)

Single-page view for one atom:

- **Source** — syntax-highlighted TypeScript, read-only
- **Metadata** — description (editable with admin/dev token), goal tag, gzip
  size, created date
- **Relationships** panel:
  - Imports (outgoing `kind=imports`) — clickable links to dependencies
  - Imported by (incoming `kind=imports`) — clickable links to dependents
  - Tests (outgoing/incoming `kind=tests`) — with pass/fail indicators from
    `test_evaluation`
  - Supersedes / superseded by — with link to `zts tops` view
- **Test history** — last N runs from `test_runs`, with result, duration, run_by
  badge (checker vs agent)
- **Properties** — current key-value properties on this atom
- **Actions** (token-gated):
  - Edit description
  - Star / unstar (admin)
  - Delete (if orphan)
  - Mark supersedes (select target atom)
  - Set / remove properties

### Graph view (`/ui/graph/<hash>`)

Interactive dependency graph centered on one atom. Renders the transitive import
tree plus supersedes edges. Nodes are clickable (navigate to atom detail).
Color-coded:

- Green: healthy (all tests pass)
- Red: defect (`violates_intent`)
- Yellow: superseded
- Grey: no test coverage

Depth-limited by default (3 levels); expandable. Uses a lightweight client-side
graph layout library (e.g., d3-force, elkjs, or dagre).

Also accessible from atom detail page as a "view graph" link.

### Lineage view (`/ui/tops/<hash>`)

Visual `zts tops` — renders the supersedes DAG from a starting atom upward to
all tops. Each node shows hash, description first line, and depth. Tops are
highlighted. Clickable to atom detail.

### Search (`/ui/search`)

Combined search interface:

- Text input with toggle: "description" (embedding) vs "code" (FTS5)
- Results show hash, description, goal, size, superseded badge
- Clicking a result goes to atom detail

### Goals (`/ui/goals`)

Goal list with:

- Name, weight (editable for admin), done status
- Atom count and recent contribution rate
- Expandable: full body (markdown rendered), comment thread

Admin actions:

- Create goal (name, weight, body)
- Edit weight and body inline
- Delete (with confirmation)

Agent actions (dev token):

- Mark done / undone
- Add comment

### Goal detail (`/ui/goals/<name>`)

Full goal view:

- Body (markdown rendered)
- Comment thread (chronological, timestamped)
- Atom list: all atoms tagged with this goal, sorted by date
- Activity chart: atoms per day for this goal

### Agent monitor (`/ui/agents`)

Per-channel view of agent loop activity:

- Channel name, current iteration number, status (running/idle/error)
- Last handover preview (first few lines of `current.md`)
- Recent iteration log: start time, duration, atoms posted, exit code
- Expandable: full handover content, iteration stream excerpt

This reads from the agent workspace via the server (the workspace directory or a
status endpoint the loop runner exposes). If the agent runs in a separate
container, the server would need a lightweight status API from the agent — or
the loop runner could POST iteration summaries to the server's log table.

### Prompts (`/ui/prompts`)

Admin-only page for editing agent prompts (context, iteration,
retrospective).

- Shows the active prompt (DB override if exists, compiled default
  otherwise)
- Edit inline with a text area, save to `prompts` table
- "Show default" button reveals the compiled-in default for comparison,
  even when an override is active
- "Reset to default" removes the DB override
- Changes take effect on the next agent iteration (no restart needed)

### Audit log (`/ui/log`)

Paginated, filterable view of the `log` table:

- Columns: timestamp, operation, subject (linked to atom/goal), actor
- Filters: operation type, actor, date range, subject
- Clicking subject navigates to the relevant atom or goal

---

## Implementation notes

### Static assets

The UI is a set of static files (HTML, JS, CSS) bundled into the server. No
build step required at runtime. Options:

1. **Embedded at compile time** — files are bundled into the Deno binary.
   Simplest deployment; no loose files.
2. **Served from a directory** — `ZTS_UI_DIR` env var points to the static
   files. Allows customization without rebuilding.

Option 1 for production, option 2 for development.

### Rendering

Server-side rendered HTML with minimal client-side JS is preferred over a heavy
SPA framework. The API already exists — the UI is a thin layer of HTML
templates + fetch calls. Client-side JS is needed for:

- Graph visualization (d3-force or similar)
- Auto-refresh on dashboard
- Inline editing (description, goal weight)
- Search-as-you-type

Everything else can be plain HTML served by the Deno process. Use `<template>`
elements or a lightweight template engine (e.g., eta, mustache) on the server
side.

### API reuse

The UI calls the same HTTP API that the CLI uses. No separate backend endpoints.
The token is passed via `Authorization` header from JS fetch calls, same as the
CLI. This means:

- Every UI action is testable via curl
- The API is the single source of truth
- No divergence between CLI and UI behavior

### Ollama

Ollama runs in the zts-server container. The server calls it locally for
embedding generation (on atom post/describe) and semantic search queries. No
external API dependency for embeddings.

Environment: `OLLAMA_MODEL` (default: a small embedding model like
`nomic-embed-text` or `all-minilm`).

---

## Routes

All UI routes are under `/ui/` to avoid collision with the API.

```
GET /ui/                    dashboard
GET /ui/atoms               corpus browser
GET /ui/atoms/<hash>        atom detail
GET /ui/graph/<hash>        dependency graph
GET /ui/tops/<hash>         lineage view
GET /ui/search              search
GET /ui/goals               goal list
GET /ui/goals/<name>        goal detail
GET /ui/agents              agent monitor
GET /ui/prompts             prompt editor (admin)
GET /ui/log                 audit log
```

Static assets served from `/ui/static/` (JS, CSS, icons).
