Status: completed

# Persist Monitoring, Discovery Triggers, and Candidate Legal Acts

## Parent

.scratch/postgresql-persistence/PRD.md

## What to build

Make RSS/search monitoring history and Candidate Legal Acts durable through PostgreSQL. A completed slice should let the dashboard run a EUR-Lex RSS Feed Run, persist the Monitor Run, persist every Discovery Trigger outcome, create or refresh Candidate Legal Acts by Legal Act Identity, restart the API, and still show the same Candidate Legal Acts and monitor history.

Discovery Triggers must be durable records linked to Monitor Runs. They are not Source Content and must not create Sanctions Delta Records by themselves. Persist malformed triggers too, because they are operational evidence even when they do not create Candidate Legal Acts.

Candidate Legal Act upsert must follow Legal Act Identity priority: CELEX ID, then CELLAR ID, then official URI. Candidates discovered first by official URI may later be enriched with CELEX or CELLAR without creating duplicates. Rediscovery from a rolling RSS feed should refresh observation metadata only; it must not reset processing state, Source Content references, retrieval history, Extraction Results, Extraction Corrections, Export Batches, or export status.

## Acceptance criteria

- [ ] Configured Base Acts are loaded from PostgreSQL.
- [ ] Watch Queries are loaded from PostgreSQL.
- [ ] Monitor Runs are persisted with source, query snapshot, timing, status, item counts, new candidate counts, errors, and search response reference metadata when applicable.
- [ ] Discovery Triggers are persisted as durable records linked to their Monitor Run.
- [ ] Discovery Triggers store source, source item ID or item hash, CELEX ID, CELLAR ID, official URI, title, publication date, trigger URL, nullable Candidate Legal Act link, status, error message, and raw trigger metadata.
- [ ] Discovery Trigger status distinguishes `CANDIDATE_CREATED`, `CANDIDATE_REFRESHED`, and `MALFORMED`.
- [ ] Malformed Discovery Triggers are persisted even when they do not create Candidate Legal Acts.
- [ ] Candidate Legal Acts are persisted in PostgreSQL.
- [ ] Candidate upsert checks CELEX ID first, then CELLAR ID, then official URI before insert.
- [ ] Official URI fallback candidates can later gain CELEX or CELLAR identity without creating duplicates.
- [ ] Repeated RSS Feed Runs refresh existing Candidate Legal Acts instead of duplicating them.
- [ ] Rediscovery updates observation metadata such as `last_seen_at`, trigger metadata, and missing or improved title, publication date, or source URL fields.
- [ ] Rediscovery does not reset candidate processing state, Source Content references, retrieval history, Extraction Results, Extraction Corrections, Export Batches, or export status.
- [ ] Running the saved EUR-Lex RSS feed can discover CELEX `32026R1055` and keep it visible after API restart.
- [ ] Monitor Runs, Discovery Triggers, and Candidate Legal Acts remain visible after API restart.
- [ ] Full typecheck, tests, and build pass.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/17-add-postgresql-runtime-persistence-boundary.md
