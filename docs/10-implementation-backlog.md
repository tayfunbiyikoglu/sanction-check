# Initial Implementation Backlog

## Current Status

The project now has a runnable Node/TypeScript API and React Evidence Workbench dashboard. The live RSS path, public CELLAR retrieval path, XHTML Annex parser, classification flow, correction flow, CSV export flow, PostgreSQL runtime persistence, and focused tests are implemented for the local prototype.

Proven live case: CELEX `32026R1055` can be discovered from the saved EUR-Lex RSS feed, retrieved from public CELLAR as official English XHTML Source Content, classified as a complete extraction, and parsed into 23 Sanctions Delta Records: 16 persons and 7 entities.

The main remaining deployment-readiness gap is hardening operational runtime concerns: environment validation, production job execution, authentication, backup/restore practice, and smoke tests against the deployment storage adapters.

## Completed Slice: PostgreSQL Persistence

The PostgreSQL persistence slice has landed for runtime state:

1. Add PostgreSQL connection/config, migration runner, and repository interfaces that match the current in-memory store contracts. PostgreSQL becomes the default API persistence mode for local runtime; in-memory repositories remain available only for focused tests or explicit fallback.
   - Migrations and baseline seed data should run through explicit commands, not hidden startup side effects.
   - API startup should connect to PostgreSQL and fail clearly when schema or required baseline configuration is missing.
   - The seed command should insert baseline Configured Base Acts and Watch Queries without overwriting operational state.
   - Repository interfaces should be module-owned and composed into application dependencies, not exposed as one giant application store.
   - Integration tests should use `TEST_DATABASE_URL` and a dedicated test database reset by migrations/truncation; pure unit tests may keep using in-memory repositories.
2. Persist configured base acts, watch queries, monitor runs, Discovery Triggers, and Candidate Legal Acts with Legal Act Identity deduplication.
   - Discovery Triggers should be durable records linked to monitor runs, including malformed triggers that do not create Candidate Legal Acts.
   - Trigger status should distinguish candidate creation, candidate refresh, and malformed triggers.
   - Candidate upsert should support Legal Act Identity enrichment: official URI fallback candidates can later gain CELEX/CELLAR identity without creating duplicates.
   - Rediscovery should refresh observation metadata only; it must not reset processing state, retrieval state, extraction state, corrections, or exports.
3. Persist Source Content references, retrieval state, extraction results, and Sanctions Delta Records while keeping source bytes outside PostgreSQL.
   - Extraction results should store the Source Content reference/hash they were produced from.
   - Changed Source Content should require explicit reprocessing and must not automatically overwrite extraction results or Sanctions Delta Records.
   - Extraction results should be append-mostly; reprocessing creates a new extraction result rather than mutating previous parser outputs.
4. Persist corrections, export batches, export batch records, export downloads, and audit events.
5. Update API routes/tests so a candidate discovered, retrieved, classified, and exported before restart is still visible after restart.

## Recommended Next Slice: Deployment Hardening

1. Validate required runtime environment at startup, including PostgreSQL, Source Content storage mode, CELLAR live retrieval config, and AI provider config when AI extraction is enabled.
2. Add a deployment smoke path that verifies database connectivity, baseline seed configuration, Source Content storage read/write, and the configured retrieval mode without printing Source Content bytes or secrets.
3. Replace local trusted actor defaults with the chosen workplace authentication and actor propagation model.
4. Decide whether the hourly RSS worker remains in-process for deployment or moves behind a dedicated scheduler/worker runtime.
5. Document backup/restore expectations for PostgreSQL and Azure Blob Storage Source Content.

## Epic 1: Project Skeleton

- Create backend service skeleton.
- Create frontend app skeleton.
- Add PostgreSQL schema/migrations.
- Add local docker-compose for app, db, queue if needed.
- Add seed data for demo candidates and extracted records.

## Epic 2: Monitoring Job

- Add hourly scheduler.
- Add job/worker abstraction that can run in-process locally.
- Add RSS feed configuration model.
- Fetch RSS items.
- Deduplicate candidate legal acts.
- Store monitor run history.
- Add retry/error handling.

## Epic 3: EUR-Lex/CELLAR Integration

- Implement live EUR-Lex Web Service search adapter that returns Discovery Triggers, not Source Content.
- Store raw EUR-Lex search responses by immutable Search Response Reference and hash for monitor audit.
- Keep Watch Query text authoritative for live search; do not regenerate queries from Configured Base Acts.
- Implement live CELLAR retrieval adapter that resolves Source Content from Candidate Legal Act identity.
- Discover available language manifestations first, store only English Source Content, and mark Language Pending when English is absent.
- Prefer XML/Formex, then HTML, then plain text for English Source Content; do not use PDF for MVP extraction.
- Keep search and retrieval independently switchable with `EURLEX_SEARCH_MODE=mock|live` and `CELLAR_RETRIEVAL_MODE=mock|live`.
- Fail live operations clearly when required endpoint or credential configuration is missing; never silently fall back to mock mode.
- Add recorded fixtures for normal tests and explicit live smoke commands for EUR-Lex search and CELLAR retrieval.

## Epic 4: Candidate Classification

- Implement Annex detection.
- Implement sanctions-relevance classifier.
- Add classification statuses.
- Store extraction result.
- Add test fixtures for no-delta vs delta documents.

## Epic 5: Annex Parser

- Build XML-first Annex parser.
- Add text fallback parser.
- Keep LLM-assisted parsing behind a later extension interface.
- Segment person/entity records.
- Extract common fields.
- Store evidence text and confidence.
- Add parser versioning.

## Epic 6: Dashboard UI

- Monitoring overview page.
- Candidate list page.
- Candidate detail page.
- Extraction correction page.
- Export center page.

## Epic 7: Extraction Correction Workflow

- Show candidates that need extraction correction.
- Edit/correct extracted records.
- Add correction notes.
- Mark a candidate extraction complete.
- Store extraction correction audit actions.

## Epic 8: CSV Export

- Generate one audit CSV per candidate legal act after extraction is complete.
- Create export batch record.
- Store file hash.
- Mark the candidate legal act and all included records as exported.
- Add download endpoint.

## Epic 9: Audit & Controls

- Add processing logs per candidate.
- Add parser version field.
- Show candidates extracted with older parser versions.
- Add explicit candidate reprocessing action.
- Add export audit view.
- Add failed job/retrieval/parsing status page.

## Suggested First Codex Iteration

1. Generate app skeleton.
2. Implement candidate legal act, sanctions delta record, and export batch models.
3. Seed one delta candidate, one no-delta candidate, and one needs-correction candidate.
4. Add mock English source content retrieval.
5. Implement delta/no-delta classification against fixtures.
6. Extract all records for a candidate and require complete extraction before export.
7. Generate one audit CSV batch for a complete candidate legal act.
8. Build dashboard screens for candidate status, extraction correction, and export batches.
