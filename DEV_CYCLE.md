# Dev Cycle

1. Implement a feature in the server (and CLI if applicable)
2. Run `deno task precommit` (fmt + test + lint)
3. Restart the server manually (ask the user)
4. Update the test plan to cover the new feature
5. Run through the relevant test plan sections
6. Fix any failures found
7. Update VISION.md annotations to reflect what's now implemented
8. Run `deno task precommit`
