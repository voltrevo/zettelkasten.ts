1. The system is a software construction environment built from **immutable
   TypeScript atoms** stored in a **content-addressed flat corpus**. ✓ _corpus
   exists; immutability enforced by server (duplicate posts are no-ops)_

2. Each atom is a **single TypeScript module exporting exactly one symbol**
   (function, class, type, constant, or factory). ✓ _enforced at submission_

3. Atoms may **import only other atoms from the same system** and may not import
   external libraries, built-ins, local paths, or arbitrary URLs. ✓ _enforced:
   only relative paths matching `../../xx/yy/<21chars>.ts` accepted_

4. Each atom is **immutable once accepted** and is **identified by a
   cryptographic content hash**, which serves as its canonical identity. ✓
   _keccak-256 (128+ bits), base36, 25 chars_

5. The logical codebase is a **flat collection of atoms with no directory
   hierarchy**; physical filesystem layout is only an implementation detail.

6. A **Deno web server is the primary operational interface**, providing APIs
   for submission, validation, retrieval, discovery, testing, execution
   planning, and graph inspection. ~ _submission and retrieval implemented;
   remainder not yet_

7. A **Git repository acts only as durable backing storage and audit history**,
   not as the operational interface. ✓ _each new atom committed with
   `<hash8>: <message>`_

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
    storage. ~ _hashing, storage, and static analysis implemented; normalization
    and metadata not yet_

12. Validation enforces constraints such as **exactly one value export,
    restricted imports, absence of obvious singleton patterns, and limits on
    size or complexity**. Additional **type-only exports are permitted** (e.g.
    `export type Cap = ...`). All exports must be **named**;
    `export
    default` is forbidden. ~ _one value export, restricted imports,
    gzip size limit (768 bytes), and type-only export allowance enforced;
    default export rejection, singleton patterns, and complexity limits not yet_

13. Static analysis heuristics detect patterns such as **exported mutable
    variables, top-level mutation, static mutable fields, or implicit caches**.
    ~ _exported mutable variables (`let`) rejected; top-level mutation, static
    mutable fields, implicit caches not yet_

14. Atoms are stored in **content-addressed files named by hash**, sharded as
    `<2chars>/<2chars>/<remainder>.ts`. ✓

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

20. Discovery mechanisms include **hash lookup, tags, relationship traversal,
    full-text search, and semantic nearest-neighbor search**.

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
    concrete implementations of external capability interfaces**.

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
