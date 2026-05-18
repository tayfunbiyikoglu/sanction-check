Status: ready-for-agent

# PRD: PostgreSQL Persistence for the Sanctions Delta Detection Dashboard

## Problem Statement

The Sanctions Delta Detection Dashboard now has a working local live prototype: it can run a EUR-Lex RSS Feed Run, discover Candidate Legal Acts, retrieve official English Source Content from public CELLAR, classify and extract EUR-Lex XHTML Annex content, and export complete Candidate Legal Acts. However, the API still keeps operational state in memory.

From the user's perspective, this means the dashboard loses discovered candidates, Monitor Runs, retrieval state, Extraction Results, Sanctions Delta Records, corrections, and Export Batches whenever the API restarts. A real EUR-Lex case such as CELEX `32026R1055` can be discovered and extracted into 23 Sanctions Delta Records, but the work disappears after restart unless the user reruns RSS, retrieval, and classification.

This blocks the product from behaving like an operational compliance tool. Monitoring history must be auditable, Candidate Legal Acts must remain durable, Discovery Triggers must be traceable, and extracted records must survive restart without treating Source Content bytes or raw search responses as relational table payloads.

## Solution

Add PostgreSQL persistence as the default local runtime persistence mode for the API. The system will keep the current dashboard and API behavior, but replace in-memory operational state with module-owned repositories backed by PostgreSQL.

The solution introduces explicit database configuration, migration, and seed commands. Normal API startup connects to PostgreSQL and fails clearly when schema or baseline configuration is missing; it does not silently migrate, reseed, or overwrite operational state. In-memory repositories remain available only for focused unit tests or explicit fallback.

The first durable slice persists Configured Base Acts, Watch Queries, Monitor Runs, Discovery Triggers, and Candidate Legal Acts with Legal Act Identity deduplication and identity enrichment. The second durable slice persists Source Content references, retrieval state, append-mostly Extraction Results, and Sanctions Delta Records. Source Content bytes and raw search/RSS responses remain outside PostgreSQL by immutable reference and hash, matching existing ADRs.

## User Stories

1. As a compliance analyst, I want Candidate Legal Acts to survive API restarts, so that discovered legal acts do not disappear from the dashboard.
2. As a compliance analyst, I want CELEX `32026R1055` to remain visible after restart once discovered, so that live EUR-Lex testing behaves like an operational workflow.
3. As a sanctions operations user, I want a retrieved and extracted Candidate Legal Act to keep its 23 Sanctions Delta Records after restart, so that I do not need to rerun extraction after every API restart.
4. As a control owner, I want Monitor Runs persisted, so that monitoring coverage can be audited over time.
5. As a control owner, I want Discovery Triggers persisted separately from Candidate Legal Acts, so that I can see what each RSS Feed Run or search run saw.
6. As an operations user, I want malformed Discovery Triggers persisted, so that malformed feed/search items remain visible as operational evidence even when they do not create Candidate Legal Acts.
7. As a compliance analyst, I want repeated RSS Feed Runs to refresh existing Candidate Legal Acts instead of duplicating them, so that rolling feeds do not create duplicate work.
8. As a compliance analyst, I want rediscovery to update only observation metadata, so that a repeated feed item does not reset retrieval, extraction, correction, or export state.
9. As a control owner, I want each Discovery Trigger to record whether it created a candidate, refreshed a candidate, or was malformed, so that monitor outcomes are explainable.
10. As a compliance analyst, I want Candidate Legal Acts deduplicated by Legal Act Identity, so that CELEX, CELLAR, and official URI signals converge on one candidate.
11. As a compliance analyst, I want official URI fallback candidates to be enriched with CELEX or CELLAR later, so that early RSS discovery can improve as better metadata appears.
12. As a control owner, I want identity enrichment to avoid duplicate candidates, so that a stronger later identity does not fork operational history.
13. As a developer, I want PostgreSQL to be the default local API persistence mode, so that normal app usage exercises the durable path.
14. As a developer, I want in-memory repositories kept for focused unit tests, so that pure domain and service behavior remains fast to test.
15. As a developer, I want module-owned repository interfaces, so that monitoring, candidates, retrieval, extraction, export, and audit can evolve without one large shared store.
16. As a developer, I want explicit migration commands, so that schema changes are controlled and visible.
17. As a developer, I want explicit seed commands, so that baseline Configured Base Acts and Watch Queries can be inserted without startup side effects.
18. As an operator, I want API startup to fail clearly if the schema or baseline configuration is missing, so that configuration errors are visible immediately.
19. As an operator, I do not want API startup to reseed or overwrite operational records, so that live monitor history cannot be silently mutated.
20. As a developer, I want separate `DATABASE_URL` and `TEST_DATABASE_URL` configuration, so that tests never touch the local development database.
21. As a developer, I want integration tests to reset a dedicated PostgreSQL test database, so that tests exercise real PostgreSQL behavior without contaminating dev state.
22. As a control owner, I want Source Content references persisted on Candidate Legal Acts, so that retrieved official content can be traced after restart.
23. As a control owner, I want Source Content bytes stored outside PostgreSQL by immutable reference and hash, so that relational tables stay focused on metadata and audit state.
24. As a compliance analyst, I want retrieval state persisted, so that language pending, failed retrieval, attempts, retry times, and source-content-changed flags survive restart.
25. As a compliance analyst, I want Extraction Results persisted, so that classification and complete-extraction state remains durable.
26. As a parser maintainer, I want Extraction Results to store the Source Content reference and hash they were produced from, so that parser outputs are reproducible.
27. As a parser maintainer, I want Extraction Results to be append-mostly, so that reprocessing creates new parser outputs instead of overwriting old ones.
28. As a control owner, I want old Extraction Results retained, so that parser-version history and reprocessing history remain auditable.
29. As a compliance analyst, I want Candidate detail to show the latest Extraction Result by default, so that the dashboard remains simple while preserving history.
30. As a compliance analyst, I want Sanctions Delta Records linked to the Extraction Result that produced them, so that records are interpreted in the right parser/source context.
31. As a control owner, I want changed Source Content to require explicit reprocessing, so that new retrieved content does not automatically rewrite extraction results.
32. As a sanctions operations user, I want changed Source Content not to create Re-Export state until reprocessing proves the exportable extraction changed, so that re-export signals remain meaningful.
33. As a developer, I want existing API contracts to keep working while persistence changes underneath, so that the dashboard remains usable throughout the migration.
34. As a developer, I want repository tests around Legal Act Identity upsert behavior, so that CELEX, CELLAR, official URI fallback, and identity enrichment are reliable.
35. As a developer, I want restart-oriented integration tests, so that durable state is proven by creating data, rebuilding app dependencies, and reading it back.
36. As a control owner, I want PostgreSQL to retain hashes and references for raw search responses, so that monitor audit remains reproducible without storing response bytes in relational tables.
37. As a compliance analyst, I want the live RSS/CELLAR workflow to remain manual-testable from the dashboard, so that the existing local validation path still works after persistence is added.
38. As an audit owner, I want persisted records to use the project glossary terms, so that database-backed behavior does not reintroduce review status, approval status, or partial exports.

## Implementation Decisions

- PostgreSQL becomes the default API persistence mode for local runtime.
- In-memory repositories remain available only for focused unit tests or explicit fallback.
- Migrations run through an explicit command. Normal API startup does not run hidden migrations.
- Baseline seed data runs through an explicit command. Normal API startup does not silently create, reseed, or overwrite operational records.
- API startup connects to PostgreSQL and fails clearly when schema or required baseline configuration is missing.
- `DATABASE_URL` configures the local runtime database.
- `TEST_DATABASE_URL` configures the dedicated integration test database.
- Integration tests must not touch the local development database.
- Repository interfaces should be module-owned and composed into app dependencies. Do not introduce one giant application store.
- Monitoring owns repositories for Watch Queries, Monitor Runs, and Discovery Triggers.
- Candidate persistence owns Candidate Legal Acts and Legal Act Identity upsert behavior.
- Retrieval persistence owns candidate retrieval state and Source Content reference metadata. Source Content bytes remain in the filesystem/object-storage abstraction.
- Classification/parser persistence owns Extraction Results and Sanctions Delta Records.
- Later export persistence will own Export Batches, Export Batch Records, Export Download Events, and export file references.
- Configured Base Acts and Watch Queries are persisted as baseline configuration for the MVP.
- Monitor Runs persist source, query snapshot, timing, item counts, new candidate counts, status, errors, and search response reference metadata when applicable.
- Discovery Triggers are durable records linked to Monitor Runs.
- Discovery Triggers include source, source item ID or item hash, Legal Act Identity fields, title, publication date, trigger URL, nullable Candidate Legal Act link, status, error message, and raw trigger metadata.
- Discovery Trigger status distinguishes `CANDIDATE_CREATED`, `CANDIDATE_REFRESHED`, and `MALFORMED`.
- Malformed Discovery Triggers are persisted even when they do not create Candidate Legal Acts.
- Candidate Legal Act upsert uses Legal Act Identity in priority order: CELEX ID, then CELLAR ID, then official URI.
- Candidate Legal Acts may first be created from official URI fallback identity.
- If CELEX ID or CELLAR ID is later discovered for the same legal act, the existing Candidate Legal Act is enriched with the stronger identity instead of creating a duplicate.
- If two existing Candidate Legal Acts are later proven to be the same legal act, they should be merged explicitly with an audit event. Automatic complex merging is out of scope unless the match is exact and safe.
- Rediscovery updates observation metadata such as `last_seen_at`, trigger metadata, and missing or improved title, publication date, or source URL fields.
- Rediscovery must not reset Candidate Legal Act processing state, Source Content references, retrieval history, Extraction Results, Extraction Corrections, Export Batches, or export status.
- Source Content references persisted on Candidate Legal Acts include reference, content hash, content length, content type, language, source URI, and retrieved timestamp.
- Retrieval state persisted on Candidate Legal Acts includes status, attempts, last attempt time, next retry time, available languages, source-content-changed flag, previous source content hash, failure code, and failure message.
- Source Content bytes remain outside PostgreSQL. PostgreSQL stores immutable references and hashes only.
- Raw EUR-Lex search responses remain outside PostgreSQL. PostgreSQL stores immutable references and hashes only.
- Extraction Results store parser version, classification, confidence, Annex presence, Annex heading, completeness flag, evidence summary, created timestamp, and the Source Content reference/hash used by that extraction.
- Extraction Results are append-mostly. Reprocessing creates a new Extraction Result rather than mutating previous parser output.
- Sanctions Delta Records belong to one Extraction Result.
- Candidate detail may show the latest Extraction Result by default, while older results remain available for audit/control views.
- Changed Source Content creates a need for explicit reprocessing and must not automatically overwrite Extraction Results or Sanctions Delta Records.
- Changed Source Content alone does not imply Re-Export. Re-Export is required only when reprocessing creates a current complete extraction whose export snapshot differs from the latest Export Batch.
- Existing dashboard/API behavior should remain stable while persistence is introduced.
- The implementation should respect existing ADRs: PostgreSQL for MVP persistence, source content by reference outside PostgreSQL, search responses by immutable reference, complete immutable export batches, English Source Content for MVP extraction, and source-backed correction.

## Testing Decisions

- Good tests should verify observable behavior: persisted state, deduplication outcomes, restart survival, API responses, and dashboard-visible state. Avoid testing private SQL helper details unless they are exposed as repository contracts.
- Unit tests may continue using in-memory repositories for pure service behavior.
- PostgreSQL integration tests should use `TEST_DATABASE_URL` and a dedicated test database reset by migrations/truncation.
- Migration tests should verify a clean database can be migrated and required tables/indexes exist.
- Seed tests should verify baseline Configured Base Acts and Watch Queries are inserted without overwriting existing operational state.
- Startup/config tests should verify missing `DATABASE_URL`, unreachable database, missing schema, or missing baseline configuration fail clearly.
- Repository contract tests should be written for module-owned repositories where feasible, with the same behavioral expectations for in-memory and PostgreSQL implementations.
- Legal Act Identity tests should cover CELEX-first upsert, CELLAR fallback, official URI fallback, identity enrichment from URI to CELEX/CELLAR, and no duplicate creation on rediscovery.
- Discovery Trigger tests should verify candidate-created, candidate-refreshed, and malformed trigger persistence.
- Monitor Run tests should verify query snapshots, item counts, new candidate counts, errors, and linked Discovery Triggers survive restart.
- Candidate refresh tests should verify rediscovery updates observation metadata only and does not reset processing, retrieval, extraction, correction, or export state.
- Retrieval persistence tests should verify Source Content reference metadata, retrieval attempts, language pending, failure state, and source-content-changed state survive restart.
- Extraction persistence tests should verify Extraction Results are append-mostly and store Source Content reference/hash.
- Sanctions Delta Record persistence tests should verify records are linked to the correct Extraction Result and survive restart.
- End-to-end API tests should verify `32026R1055` can be discovered, retrieved, classified, extracted into 23 Sanctions Delta Records, restarted/recreated at the app dependency layer, and read back with complete extraction intact.
- Tests should verify Source Content bytes and raw search responses are not stored as relational table payloads.
- Existing full checks should still pass: typecheck, unit tests, integration tests, and build.

## Out of Scope

- Adding a production scheduler or external queue.
- Changing EUR-Lex RSS, EUR-Lex Web Service, or CELLAR integration behavior.
- Implementing final PTM-specific CSV mapping.
- Replacing filesystem Source Content storage with object storage.
- Storing Source Content bytes directly in PostgreSQL.
- Storing raw EUR-Lex search/RSS response bytes directly in PostgreSQL.
- Adding watch query/configured base act management UI.
- Adding bank SSO.
- Adding new approval/rejection workflow, per-record review status, partial exports, or manual false-positive deletion.
- Automatically reprocessing candidates when Source Content changes.
- Automatically merging ambiguous duplicate Candidate Legal Acts.
- Implementing full historical audit UI for older Extraction Results.
- Persisting export batches and correction actions in the first two persistence issues unless the implementation reaches the later export/audit slice.

## Further Notes

- This PRD is a follow-on to the original Sanctions Delta Detection Dashboard PRD. It narrows the next implementation slice to durability.
- The current live positive case is CELEX `32026R1055`, Council Implementing Regulation (EU) 2026/1055 of 11 May 2026, which contains an Annex adding 16 persons and 7 entities. It should be used as the primary live/manual verification case.
- The project glossary remains binding. Use Candidate Legal Act, Discovery Trigger, RSS Feed Run, Source Content, Extraction Result, Sanctions Delta Record, Complete Extraction, Export Batch, and Re-Export exactly.
- The next issues from this PRD should be Issue 17, Issue 18, and Issue 19 in the existing Sanctions Delta Dashboard issue sequence.
