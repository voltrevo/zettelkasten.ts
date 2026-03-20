# Discoverability

## What was observed

Agents have no way to enumerate the corpus. There is no `/list` endpoint and no
`zts list` command. The only discovery path is semantic search — which requires
knowing approximately what vocabulary to use.

This creates a blind spot: an agent building "a Huffman encoder" may not find
the existing `huffmanCoding` atom because it searched for "Huffman compress" or
"variable-length code." Both agents across the bricklane and starling channels
maintained hand-crafted atom inventory tables in their handover docs — a clear
signal that the system wasn't providing this information.

The consequences, observed repeatedly:

- **Duplicate atoms.** Two distinct AES-128-GCM implementations in the corpus
  (found in early bricklane iterations). Multiple wasm executor variants
  accumulated because each agent couldn't enumerate what already existed.
  Multiple Markdown pipeline atoms with overlapping capability sets.

- **Context burned on inventory.** By the 150th bricklane iteration, the
  handover's "what already exists" section listed 30+ SVG atoms with version
  numbers. This information had to be reconstructed every iteration from memory
  and search, consuming significant context window.

- **Wasted work from misses.** Agents expressed explicit uncertainty: "I
  searched three ways and felt confident it was missing — but couldn't be
  certain." Uncertainty about whether something exists leads to rebuilding
  rather than reusing.

## Why it matters

The system is designed around accumulation. Each atom is supposed to be a
permanent asset a future agent can build on. That only works if the future agent
can find it. A corpus that grows but remains opaque provides diminishing
returns: the more atoms there are, the harder it is to know what's there.

## What good looks like

An agent should be able to answer "what do I already have related to X?" with a
complete answer, not a probabilistic one. This means both:

1. A way to enumerate atoms (all, or filtered by some criterion)
2. Relationship-based navigation ("what atoms import this one?", "what atoms
   does this goal have?")

The second is as important as the first: once you find one atom in a cluster,
you should be able to find its neighbors.

## Agent-invented workarounds

Because there is no browse endpoint, agents maintained their own discovery
artifacts:

- **`TOP_10.md` / `TOP_10_v2.md`** — hand-curated lists of the most impressive
  atoms, kept up to date across sessions. Agents were instructed to read these
  at the start of each loop to know what exists.
- **`IMPRESSIVE_EXAMPLES.md`** — a running list of runnable `zts exec` commands
  demonstrating corpus capabilities. Agents appended to it when they built
  something notable.
- **Handover inventory tables** — every handover doc included a "what already
  exists" section for the current goal area, manually maintained.
- **`RESULTS.md` / session notes** — ad-hoc session summaries listing new atoms
  by hash, maintained because there was no other record of what was built.

These artifacts are valuable, but their existence is itself a signal: agents
spent real effort maintaining them because the system didn't provide the
information automatically. The maintenance burden grew with the corpus.

## Adjacent observations

- `zts search` returns semantic neighbors, which is good for discovery but
  unreliable for "does this exact thing exist?" Both are needed.
- Atoms with poor descriptions are invisible to search and get reinvented. There
  is no feedback signal for "this atom is never found by search but is
  frequently retrieved by hash" — which would identify descriptions that need
  rework.
- The capability/interface of an atom is not indexed. There is no way to search
  for "atoms that export a function taking (Uint8Array) → number" — only prose
  descriptions.
