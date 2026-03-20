# The 768-byte gzip size limit

## What was observed

The 768-byte gzip-after-minification limit is the most frequently mentioned
constraint across all iterations from both channels. It was a live constraint in
most multi-atom builds, not just an occasional edge case.

### The good: the limit is a real design force

When an atom approached the limit, the correct response — split at a genuine
boundary — consistently produced better design. Examples:

- `gitLogPack` was split into `gitReadObject` (reusable) + a CLI atom. The split
  was discovered because of the size limit. `gitReadObject` became a useful
  primitive that other atoms now import.
- A CLI atom with an embedded help string extracted it into `lifeUsage` (a
  constant atom). The help string is now a separately searchable asset.
- Large lookup tables (HPACK static table, VGA font bitmap) factored into their
  own atoms — the right design regardless of the limit.

The limit works as intended when it pushes toward smaller, better-bounded atoms.

### The bad: the limit causes real readability harm

When the limit is tight and the design is already correct, agents were observed
doing the following to fit:

- **Removing TypeScript type annotations.** Agents discovered the minifier does
  not strip type annotations, so they removed them manually. This degrades type
  safety and readability.
- **Single-character variable names inside functions.** Explicitly harmful to
  readability, done only for byte savings.
- **Shortened error messages** (`throw new Error(nm)` instead of a descriptive
  string). Debugging becomes harder.
- **Removing non-null assertions (`!`)** from calls. Type safety sacrificed.
- **Using `!= null` instead of `!== undefined`** and `c.tag` instead of
  `typeof c !== 'string'` — semantically equivalent but chosen for gzip
  compression characteristics.
- **Inlining helpers** (LEB128 encoders, length utilities) rather than importing
  them, because one fewer import path saves ~40 bytes.
- **Accepting a dependency as a parameter** rather than importing it — a leaky
  abstraction forced by size.

These are not theoretical concerns. They appeared in multiple atoms across both
channels, and the agents noted them explicitly as trade-offs forced by the
limit.

### The worst case: split decisions that are architecturally wrong

Some splits were purely size-driven and produced worse design:

- `svgInheritStyle`, `svgTextWalk`, `c32BinopOpcodes` — all extracted not
  because they're conceptually independent but because the parent atom needed
  room.
- Multiple wasm executor variants (V1–V18 in starling) where each version added
  one feature the previous couldn't fit. The chain exists not because the
  features are separable concerns but because they couldn't coexist at 768B.

The clearest signal: agents were observed reverse-engineering gzip compression
behavior (hex vs decimal for opcodes, repetitive patterns vs bit tricks) to hit
the limit. This is a maintenance burden that produces unmaintainable code.

## The counterargument

The limit has real value. It prevents "grab-bag" atoms that do too much. The
discipline of asking "what should be a separate atom?" consistently produces
better decomposition. A higher limit might produce worse designs.

The question is not whether to have a limit, but whether the current limit is
calibrated correctly for data-heavy atoms (lookup tables, font bitmaps, Huffman
code tables) that are inherently large without being architecturally wrong.

## Adjacent observations

- The 768B limit applies uniformly to data atoms and logic atoms. A 61-entry
  HPACK static table and a 61-line algorithm have the same budget. Data-heavy
  atoms are structurally disadvantaged.
- The `consoleFontData` atom (VGA bitmap font) is right at the limit and cannot
  be extended. The font data and the code using it had to be two atoms, purely
  because of size.
- The "minifier does not strip type annotations" behavior is counterintuitive
  and was rediscovered multiple times. It should be documented prominently.
