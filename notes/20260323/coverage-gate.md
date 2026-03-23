# Coverage gate for publish

Reject publish if test coverage is insufficient. The c32Parse case shows the
problem: tests pass but only exercise imports, params, and return — while/for/
else/precedence are implemented but untested. A later agent will discover this
when building on it, but we could catch it at publish time.

## Key finding from spike

Deno's `--coverage` does NOT instrument HTTP-imported modules. Since atoms are
served over HTTP, the target must be written to a local temp file for coverage
to work. Dependencies can stay as HTTP imports.

`deno coverage --detailed` gives exactly the output we want:

```
cover classify.ts ... 60.000% (3/5)
   4 |   if (n < 0) return "negative";
   5 |   return "zero";
```

This can be returned directly to the agent as the rejection message.

## Import rewriting

When the target atom is saved locally, its relative imports break:

```ts
import { foo } from "../../ab/cd/efghijklmnopqrstuvw.ts";
```

Rewrite to HTTP URLs:

```ts
import { foo } from "http://server/a/ab/cd/efghijklmnopqrstuvw.ts";
```

Safe because atom imports are constrained to exactly this `../../xx/yy/rest.ts`
format. Simple regex: `../../` → `${serverUrl}/a/`.

## Implementation

### Checker: new `POST /check-coverage` endpoint

1. Accepts `{ serverUrl, targetHash, testHashes }` (same as `/check`)
2. Fetches target atom source, writes to temp file
3. Rewrites relative atom imports to HTTP URLs
4. Generates a modified test runner importing target locally
5. Runs `deno test --coverage=<dir> ...`
6. Runs `deno coverage <dir> --detailed`, filters to target file
7. Returns
   `{ passed, lines: {covered, total}, branches: {covered, total}, uncoveredDetail }`

### Server: enforce at publish time

In `POST /publish/<hash>`, after confirming tests exist:

1. Call checker `/check-coverage`
2. Reject with 422 if coverage below threshold
3. Include uncovered lines in error so agent sees exactly what to fix

### Thresholds

Start with 100% line coverage on the target atom. Strict but the agent sees
exactly what's missing and can fix it. Only check the target, not transitive
deps (those were covered at their own publish time).

### Performance

Coverage only runs at publish time, not on `add-test`. Adds ~50% overhead to one
test run. Acceptable since publish is infrequent.

### Files to modify

- src/checker.ts — new `/check-coverage` endpoint
- src/server.ts — call coverage during publish, reject if insufficient
- src/api-client.ts — coverage fields in PublishResult
- main.ts — show coverage/uncovered lines in publish output
- src/integration.test.ts — coverage gate test steps
