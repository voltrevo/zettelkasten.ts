# Concepts — future improvement

## What a concept is

A concept is a hierarchical, immutable collection of test suites that defines a
particular capability. It replaces explicit test collections as the primary
identity mechanism for what an atom _is_.

## How it changes the workflow

Current: post atom with explicit `-t <test1,test2>` — you choose which tests
apply.

Future: define a concept (e.g. "gcd") as a set of test suites. Post atoms
_against a concept_. The concept's tests are the definition of what it means to
implement that concept.

```
zts concept define gcd --tests <suite1,suite2>
zts post -d "..." --concept gcd /tmp/gcd.ts
```

## Why this matters

An atom conforms to a concept because it passes the concept's tests. Two atoms
that both conform to the same concept are interchangeable for that purpose —
even if they have completely different implementations.

This gives a clear path to posting improved versions: the new version conforms
to the same concept. It's "the same thing" not because of a supersedes
relationship (which is a manual judgment) but because it satisfies the same
test-defined contract.

## Hierarchy

Concepts can be hierarchical: "sortable" might require "comparable". An atom
that conforms to "sortable" implicitly conforms to "comparable" because
sortable's test suites include comparable's.

Concepts are immutable once defined — you can extend them (add sub-concepts or
additional test suites) but not remove tests. Removing a test would change the
meaning of conformance for all atoms that passed against the old definition.

## Relationship to current design

- Replaces the manual `-t` test list with a named, reusable definition
- Supersedes becomes less important — concept conformance implies equivalence
- `zts tops` can be scoped: "best atom conforming to concept X"
- Search can be concept-aware: "find all atoms that implement gcd"
- The test_evaluation layer still applies — violates_intent means an atom that
  previously conformed no longer does (regression)

## Not in current plans

This is a significant design change that should be prototyped after the core
system is stable and in use. The current explicit test workflow is sufficient
and this builds on top of it.
