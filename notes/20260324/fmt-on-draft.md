Server should run `deno fmt` on incoming drafts before storing them.

Agent-written code is often poorly formatted (minified variable names,
inconsistent spacing, no newlines). Running fmt on ingest normalizes everything
and makes atoms readable when reviewed later.
