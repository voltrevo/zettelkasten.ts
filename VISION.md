1. The system is a software construction environment built from **immutable
   TypeScript atoms** stored in a **content-addressed flat corpus**.
   - [x] corpus exists
   - [x] immutability enforced (duplicate posts are no-ops)

2. Each atom is a **single TypeScript module exporting exactly one symbol**
   (function, class, type, constant, or factory).
   - [x] enforced at submission

3. Atoms may **import only other atoms from the same system** and may not import
   external libraries, built-ins, local paths, or arbitrary URLs.
   - [x] enforced: only relative paths matching `../../xx/yy/<21chars>.ts`
         accepted

4. Each atom is **immutable once accepted** and is **identified by a
   cryptographic content hash**, which serves as its canonical identity.
   - [x] keccak-256 (128+ bits), base36, 25 chars

5. The logical codebase is a **flat collection of atoms with no directory
   hierarchy**; physical filesystem layout is only an implementation detail.

6. A **Deno web server is the primary operational interface**, providing APIs
   for submission, validation, retrieval, discovery, testing, execution
   planning, and graph inspection.
   - [x] submission
   - [x] retrieval
   - [x] bundle endpoint
   - [ ] /health endpoint
   - [ ] discovery
   - [ ] testing
   - [ ] execution planning
   - [ ] graph inspection

7. A **Git repository acts only as durable backing storage and audit history**,
   not as the operational interface.
   - [x] each new atom committed with `<hash8>: <message>`

8. Atoms must **not contain hidden shared state**, including exported
   singletons, mutable top-level variables, or static caches.

9. Atoms may define **state creation mechanisms** (classes, factories, local
   variables) but must not embody **ambient long-lived state**.

10. Interaction with the external world (e.g., storage, network, time,
    randomness) must occur only through **explicit capability interfaces passed
    as parameters**, not imports.

    - The capability parameter is conventionally named **`cap`** and is always
      the **first argument** of a function atom or the **first constructor
      argument** of a class atom (stored as `this.cap`). Its type declares
      exactly the external surface the atom requires, e.g.
      `cap: { Math: Pick<Math, "random">; fetch: typeof fetch }`.
    - The **real-world `cap` mirrors the global API** — callers pass
      `{ Math, Date, fetch, crypto }` — making the default binding zero-cost.
      Test implementations substitute only the capabilities under test.
    - An atom that needs external capabilities **should export a `Cap` type**
      alongside its primary export. Atoms with no external dependencies need not
      export `Cap`. If an atom imports other atoms that export `Cap`, its own
      `Cap` is the intersection of those plus any additional capabilities it
      needs directly:
      `export type Cap = DepA.Cap & DepB.Cap & { fetch: typeof fetch }`.
      TypeScript structural typing ensures the caller satisfies the full surface
      once, regardless of how many atoms share the same capability.
    - The **assembly point** satisfies the full transitive `Cap` surface by
      passing the actual globals; capability auditing can be done statically by
      inspecting exported `Cap` types across the atom graph.

11. Atom submission goes through a **server validation pipeline** including
    parsing, normalization, hashing, static analysis, metadata extraction, and
    storage.
    - [x] hashing
    - [x] storage
    - [x] static analysis
    - [ ] normalization
    - [ ] metadata extraction

12. Validation enforces constraints such as **exactly one value export,
    restricted imports, absence of obvious singleton patterns, and limits on
    size or complexity**. Additional **type-only exports are permitted** (e.g.
    `export type Cap = ...`). All exports must be **named**; `export default` is
    forbidden.
    - [x] exactly one value export
    - [x] restricted imports
    - [x] gzip size limit (768 bytes)
    - [x] type-only export allowance
    - [ ] default export rejection
    - [ ] singleton pattern detection
    - [ ] complexity limits

13. Static analysis heuristics detect patterns such as **exported mutable
    variables, top-level mutation, static mutable fields, or implicit caches**.
    - [x] exported mutable variables (`let`) rejected
    - [ ] top-level mutation detection
    - [ ] static mutable fields detection
    - [ ] implicit cache detection

14. Atoms are stored in **content-addressed files named by hash**, sharded as
    `<2chars>/<2chars>/<remainder>.ts`.
    - [x] implemented

15. A **relational database tracks atoms, tests, relationships, problems, and
    optional metadata**.

16. A **generic relationships table** represents edges such as `depends_on`,
    `has_tag`, `passes_test`, `improves`, `related_to`, `rated`, or
    `has_problem`.

17. Atom dependencies are automatically extracted and stored as **graph
    relationships**.

18. The system supports **reverse dependency queries** to identify which atoms
    depend on others.

19. The system maintains **embeddings for atoms** to support semantic search and
    related-code discovery.
    - [x] SQLite-backed embedding store (`zts.db`)
    - [x] in-memory flat vector index (cosine similarity, loaded at startup)
    - [x] `POST /a/<hash>/description` — embed and index a description
    - [x] `GET /a/<hash>/description` — retrieve description

20. Discovery mechanisms include **hash lookup, tags, relationship traversal,
    full-text search, and semantic nearest-neighbor search**.
    - [x] hash lookup (`GET /a/<aa>/<bb>/<rest>.ts`)
    - [x] semantic nearest-neighbor search (`GET /search?q=&k=`)
    - [ ] tags, relationship traversal, full-text search

21. Retrieval results are **reranked using multiple signals**, such as semantic
    similarity, graph centrality, test coverage, audits, ratings, recency, and
    problem reports.

22. The system uses **hybrid retrieval**: vector search produces candidates
    which are reranked using graph and trust metrics.

23. There is **no formal versioning system**; improvements are represented via
    relationships such as `improves`.

24. Old atoms are **never modified or deleted**; evolutionary history is
    represented purely by graph relationships.

25. Execution occurs by assembling a **dependency graph of atom imports plus
    concrete implementations of external capability interfaces**. The CLI serves
    as the **universal entry point**: `zts exec <hash> [args...]` spawns
    `run.ts` in a fresh process, which imports the root atom and calls
    `main(globalThis)`; extra args are forwarded and visible as `Deno.args`.
    `zts exec <file.zip>` runs a local bundle instead. `zts bundle <hash>`
    downloads a store-only ZIP containing all transitive atoms and a `run.ts`
    entry point.
    - [x] `zts exec <hash> [args...]`
    - [x] `zts exec <file.zip>`
    - [x] `zts bundle <hash>` — store-only ZIP with `run.ts` entry point
    - [ ] graph safety checks before execution

26. Atoms are **imported directly via Deno URL imports**, e.g.
    `https://atom-server/a/xy/zw/<remainder>.ts`.

27. Before execution, the system performs **graph safety checks** to detect
    known problems, missing tests, security issues, or better alternatives.

28. Testing is a **first-class artifact** where tests target one or more atoms
    and execute against the real dependency graph.

29. Internal atom dependencies are **not mocked in tests**; only external
    capability interfaces may be substituted.

30. Test categories may include **behavior, property, regression, performance,
    security, and compatibility tests**.

31. Test results are **recorded and attributable**, allowing atoms to accumulate
    trust signals over time.

32. Atoms are expected to be **small and focused**, with enforceable thresholds
    on size, complexity, branching, parameters, and imports.

33. Embeddings enable **semantic discovery from both code queries and
    natural-language descriptions**.
    - [x] descriptions embedded with `nomic-embed-text` via Ollama (or any
          OpenAI-compatible endpoint)
    - [x] `zts search <query>` CLI command
    - [x] `zts describe <hash> -m <text>` CLI command

34. AI agents interact with the system by **retrieving existing atoms,
    preferring reuse, and submitting new atoms only when necessary**.

35. The system acts as a **persistent knowledge substrate for code**, allowing
    agents to accumulate reusable implementations over time.

36. The Deno server provides HTTP endpoints for **atom submission, retrieval,
    relationship management, search, tests, health checks, and import serving**.

37. The import endpoint returns **stable TypeScript modules corresponding
    exactly to atom content hashes**.

38. Execution can occur against either the **live server or a reproducible
    snapshot of atom hashes**.

39. The system prioritizes **deterministic behavior, explicit interfaces, and
    reproducible builds** through immutability and content addressing.

40. Overall, the system models software as an **immutable dependency graph of
    minimal code units enriched with metadata, relationships, tests, and
    semantic embeddings**, optimized for **AI-assisted development and
    discovery**.

suggest an implementation order for the properties above
