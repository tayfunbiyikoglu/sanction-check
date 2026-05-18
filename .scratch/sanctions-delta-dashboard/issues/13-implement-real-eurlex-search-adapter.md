Status: completed

# Implement Real EUR-Lex Search Adapter

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add a live EUR-Lex Web Service search adapter that executes stored Watch Query text and returns Discovery Triggers for the monitoring service. The adapter must not retrieve Source Content, create Candidate Legal Acts directly, or create Sanctions Delta Records. Store the raw EUR-Lex search response as an immutable Search Response Reference for monitor audit.

## Acceptance criteria

- [ ] Live search adapter accepts Watch Query text and Monitor Window context, and returns Discovery Triggers.
- [ ] Discovery Triggers include CELEX ID, CELLAR ID when available, official document URI, title, publication date, source URL, and discovered timestamp when present in the search response.
- [ ] Search results are accepted only when they include at least one Legal Act Identity field: CELEX ID, CELLAR ID, or official document URI.
- [ ] Title-only search results are recorded as malformed trigger errors and do not create Candidate Legal Acts.
- [ ] Candidate creation and merging remain owned by Legal Act Identity deduplication in the monitoring service.
- [ ] Later search metadata can upgrade URI-only or CELLAR-only candidates to CELEX identity without creating duplicates.
- [ ] Raw EUR-Lex search responses are stored outside PostgreSQL by immutable Search Response Reference and hash.
- [ ] Mock/recorded search fixtures remain available for normal tests.
- [ ] Tests cover fixture parsing, malformed trigger handling, Search Response Reference storage, and existing deduplication behavior.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/02-deduplicate-discovery-triggers-by-legal-act-identity.md
- .scratch/sanctions-delta-dashboard/issues/11-add-operational-audit-and-alert-visibility.md
- .scratch/sanctions-delta-dashboard/issues/12-harden-the-mvp-test-harness-and-fixture-library.md
