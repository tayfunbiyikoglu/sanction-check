Status: completed

# Store Official English Source Content by Immutable Reference

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add mock EUR-Lex/CELLAR retrieval, English-only source selection, language-pending behavior, filesystem source content storage, content hashes, and API/UI visibility for retrieval state.

## Acceptance criteria

- [ ] Source content is stored outside relational tables by immutable reference and content hash.
- [ ] English source content is selected for MVP extraction.
- [ ] Candidates become language pending when English content is unavailable.
- [ ] Retrieval failures are represented without dumping extracted sensitive data into logs.
- [ ] Tests cover successful retrieval, language pending, and retrieval failure behavior.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/01-persist-candidate-legal-acts-from-seeded-watch-queries.md
