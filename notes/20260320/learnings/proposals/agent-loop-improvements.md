# Proposal: agent loop improvements

These address the friction points documented in `../05-agent-loop.md`. The loop
format itself is good — these proposals are about the tooling around it.

---

## Enforce handover writing

Two iterations across ~350 total produced no handover-out.md. The missing
iterations were unrecoverable except by re-inferring state from the corpus.

The loop runner could detect a missing `next.md` and either:

1. Log a warning and use the last `current.md` again
2. Refuse to start the next iteration until the agent writes a handover

Option 2 is too strict (a crashed agent can't write a handover). Option 1 at
minimum makes the gap visible in the run log rather than silent.

A lightweight version: the loop could check that `next.md` was written and is
newer than the iteration start time. If not, emit a prominent warning in the
next agent's context.

---

## Reduce inventory burden

The biggest context cost in handovers is the atom inventory: "here is what
already exists." This grows with the corpus. By the 150th iteration, an SVG
inventory table had 30+ entries.

This burden exists because there is no `/list` endpoint. The fix is the list
endpoint (see `../proposals/cli-additions.md`), not a handover format change.
Once agents can enumerate atoms programmatically, handovers can say "see
`zts list --recent 20`" instead of carrying the full table.

---

## Canonicalize version lineages

Atoms that supersede earlier versions (V1 → V2 → V3...) have no machine-readable
lineage. The handover carries this in prose. A `supersedes` relationship kind
would make this explicit:

```sh
# After posting wasmFuncRunnerV2 that supersedes V1:
zts relate <v2-hash> <v1-hash> supersedes
```

Effects:

- Search results could show "this atom has been superseded by X"
- `zts exec` could warn or auto-redirect when given a superseded hash
- The canonical current version of a lineage is discoverable without reading
  handover history

This is different from `kind=fails` (which says "this atom is broken") —
supersession says "this atom is correct but there is a better version."

---

## Standardize iteration numbering

Currently agents use their own internal counter that may not match the file
system's per-run counter. Cross-referencing "see iteration 38" is ambiguous.

The simplest fix: the loop runner stamps the handover template with a globally
monotonic iteration number (across all runs of the channel). The agent uses this
number in the header. File folder names remain per-run (`iter-0001`, etc.) but
the handover header has an authoritative monotonic count.

---

## Prominent documentation of recurrent gotchas

These were rediscovered multiple times by independent agents and should be in
the primary CLAUDE.md agent guide, not just LEARNINGS.md:

1. **ASCII-only commit messages and descriptions** — Unicode causes ByteString
   errors. Mention this at the top of the agent guide, not buried in notes.

2. **Describe atoms immediately after posting** — a separate `zts describe` call
   is required; skipping it causes 422 on all subsequent dependent posts. The
   agent guide should make this a numbered step in the workflow, not a tip.

3. **TypeScript type annotations count toward gzip budget** — the minifier does
   not strip them. This is counterintuitive and important for any atom
   approaching the size limit.

4. **`127.0.0.1` not `localhost` for Deno TCP connections** — Deno resolves
   `localhost` to IPv6 (`::1`) in many environments.

5. **`export` keyword required for `zts exec` to call a function by name** —
   functions without `export` produce "export not found" errors.
