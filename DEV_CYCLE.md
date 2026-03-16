# Dev Cycle

1. Implement a feature in the server (and CLI if applicable)
2. Write automated tests if they fit neatly; add to TEST_PLAN.md only for things
   that are tricky to automate (daemon lifecycle, interactive behaviour, real
   git state, etc.)
3. Run `deno task precommit` (fmt + test + lint)
4. Run `deno task zts restart`
5. Run through any relevant TEST_PLAN.md sections
6. Fix any failures found
7. Update VISION.md annotations to reflect what's now implemented
8. Run `deno task precommit`
