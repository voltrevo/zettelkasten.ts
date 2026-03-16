1. The system is a software construction environment built from **immutable TypeScript snippets** stored in a **content-addressed flat corpus**.

2. Each snippet is a **single TypeScript module exporting exactly one symbol** (function, class, type, constant, or factory).

3. Snippets may **import only other snippets from the same system** and may not import external libraries, built-ins, local paths, or arbitrary URLs.

4. Each snippet is **immutable once accepted** and is **identified by a cryptographic content hash**, which serves as its canonical identity.

5. The logical codebase is a **flat collection of snippets with no directory hierarchy**; physical filesystem layout is only an implementation detail.

6. A **Deno web server is the primary operational interface**, providing APIs for submission, validation, retrieval, discovery, testing, execution planning, and graph inspection.

7. A **Git repository acts only as durable backing storage and audit history**, not as the operational interface.

8. Snippets must **not contain hidden shared state**, including exported singletons, mutable top-level variables, or static caches.

9. Snippets may define **state creation mechanisms** (classes, factories, local variables) but must not embody **ambient long-lived state**.

10. Interaction with the external world (e.g., storage, network, time, randomness) must occur only through **explicit capability interfaces passed as parameters**, not imports.

11. Snippet submission goes through a **server validation pipeline** including parsing, normalization, hashing, static analysis, metadata extraction, and storage.

12. Validation enforces constraints such as **exactly one export, restricted imports, absence of obvious singleton patterns, and limits on size or complexity**.

13. Static analysis heuristics detect patterns such as **exported mutable variables, top-level mutation, static mutable fields, or implicit caches**.

14. Snippets are stored in **content-addressed files named by hash**, optionally sharded by prefix.

15. A **relational database tracks snippets, tests, relationships, problems, and optional metadata**.

16. A **generic relationships table** represents edges such as `depends_on`, `has_tag`, `passes_test`, `improves`, `related_to`, `rated`, or `has_problem`.

17. Snippet dependencies are automatically extracted and stored as **graph relationships**.

18. The system supports **reverse dependency queries** to identify which snippets depend on others.

19. The system maintains **embeddings for snippets** to support semantic search and related-code discovery.

20. Discovery mechanisms include **hash lookup, tags, relationship traversal, full-text search, and semantic nearest-neighbor search**.

21. Retrieval results are **reranked using multiple signals**, such as semantic similarity, graph centrality, test coverage, audits, ratings, recency, and problem reports.

22. The system uses **hybrid retrieval**: vector search produces candidates which are reranked using graph and trust metrics.

23. There is **no formal versioning system**; improvements are represented via relationships such as `improves`.

24. Old snippets are **never modified or deleted**; evolutionary history is represented purely by graph relationships.

25. Execution occurs by assembling a **dependency graph of snippet imports plus concrete implementations of external capability interfaces**.

26. Snippets are **imported directly via Deno URL imports**, e.g. `https://snippet-server/s/<hash>`.

27. Before execution, the system performs **graph safety checks** to detect known problems, missing tests, security issues, or better alternatives.

28. Testing is a **first-class artifact** where tests target one or more snippets and execute against the real dependency graph.

29. Internal snippet dependencies are **not mocked in tests**; only external capability interfaces may be substituted.

30. Test categories may include **behavior, property, regression, performance, security, and compatibility tests**.

31. Test results are **recorded and attributable**, allowing snippets to accumulate trust signals over time.

32. Snippets are expected to be **small and focused**, with enforceable thresholds on size, complexity, branching, parameters, and imports.

33. Embeddings enable **semantic discovery from both code queries and natural-language descriptions**.

34. AI agents interact with the system by **retrieving existing snippets, preferring reuse, and submitting new snippets only when necessary**.

35. The system acts as a **persistent knowledge substrate for code**, allowing agents to accumulate reusable implementations over time.

36. The Deno server provides HTTP endpoints for **snippet submission, retrieval, relationship management, search, tests, health checks, and import serving**.

37. The import endpoint returns **stable TypeScript modules corresponding exactly to snippet content hashes**.

38. Execution can occur against either the **live server or a reproducible snapshot of snippet hashes**.

39. The system prioritizes **deterministic behavior, explicit interfaces, and reproducible builds** through immutability and content addressing.

40. Overall, the system models software as an **immutable dependency graph of minimal code units enriched with metadata, relationships, tests, and semantic embeddings**, optimized for **AI-assisted development and discovery**.

suggest an implementation order for the properties above