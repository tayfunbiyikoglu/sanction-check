Status: completed

# Add Live EUR-Lex Integration Tests

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add recorded fixture tests for live adapter parsing and explicit manual smoke tests for real EUR-Lex Web Service search and CELLAR retrieval. Normal typecheck/test/build must not depend on live EUR-Lex or CELLAR availability.

## Acceptance criteria

- [x] Normal tests use recorded EUR-Lex search fixtures and recorded CELLAR retrieval fixtures.
- [x] Normal tests do not call live EUR-Lex or CELLAR.
- [x] A manual live search smoke command can run a configured Watch Query and report safe Discovery Trigger counts and Legal Act Identity values.
- [x] A manual live CELLAR retrieval smoke command can retrieve a known CELEX/CELLAR document in English and report Source Content reference/hash metadata.
- [x] Search and retrieval smoke tests are independently runnable.
- [x] Live smoke tests require explicit opt-in environment configuration such as `RUN_LIVE_EURLEX_SMOKE=1`.
- [x] Smoke output avoids extracted names, dates of birth, identifiers belonging to listed entries, addresses, Source Content bytes, and Evidence Text.
- [x] Documentation explains how to run the live smoke tests and what a successful result means.
- [x] Full `typecheck`, normal tests, and build pass without live credentials.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/15-add-live-integration-configuration-and-safe-toggle.md
