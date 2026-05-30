# Architecture

## High-Level Components

```text
+------------------+      +---------------------+      +------------------+
| Scheduler        | ---> | EUR-Lex Monitor     | ---> | Candidate Store  |
| hourly job       |      | RSS/Search polling  |      | dedupe/status    |
+------------------+      +---------------------+      +------------------+
                                      |
                                      v
                           +---------------------+
                           | Content Retrieval   |
                           | EUR-Lex/CELLAR APIs |
                           +---------------------+
                                      |
                                      v
                           +---------------------+
                           | Classifier/Parser   |
                           | Annex extraction    |
                           +---------------------+
                                      |
                                      v
+------------------+      +---------------------+      +------------------+
| Dashboard UI     | <--- | Correction API      | ---> | CSV Export       |
| inspection/correct|      | extraction workflow |      | complete batches |
+------------------+      +---------------------+      +------------------+
                                      |
                                      v
                           +---------------------+
                           | Audit Log           |
                           +---------------------+
```

## Suggested Tech Stack for MVP

The current implementation uses:

- Backend: Node.js with TypeScript
- Scheduler: in-process/manual job routes for the local MVP, with a scheduler boundary still expected
- Database: PostgreSQL for MVP persistence
- Current persistence: PostgreSQL-backed operational state plus immutable source/search artifacts outside PostgreSQL. Source Content can use local filesystem storage or Azure Blob Storage through the same reference format.
- Queue: job/worker abstraction from the start; local MVP may run jobs in-process before choosing Redis, RabbitMQ, Temporal, or a cloud queue
- Frontend: React with TypeScript
- Parsing: XML-first parser with EUR-Lex XHTML Annex table support and fallback text extraction
- Export: Server-side CSV generation
- Auth: Bank SSO later; local trusted prototype user for MVP with actor fields stored on audit events

## Current Implementation Status

The local dashboard can run the saved EUR-Lex RSS feed, create or refresh Candidate Legal Acts, retrieve official English Source Content from public CELLAR for known CELEX/CELLAR identities, classify the Source Content, extract EUR-Lex XHTML Annex tables, and export complete candidates.

PostgreSQL persistence is wired for local runtime. Focused tests may still use in-memory stores, but runtime Candidate Legal Act state, monitor runs, retrieval state, extraction results, corrections, and export state are expected to be durable. Source Content bytes remain outside PostgreSQL and are addressed by immutable references.

## Processing Flow

1. Hourly scheduler starts monitoring run.
2. RSS/search adapter fetches candidate legal acts.
3. Candidate records are deduplicated.
4. Content retrieval service resolves official content using EUR-Lex/CELLAR identifiers.
5. Classifier checks sanctions relevance and Annex presence.
6. Parser extracts persons/entities from Annex sections.
7. Records are stored with evidence and confidence score.
8. Dashboard shows candidates and extracted deltas.
9. Analyst corrects incomplete or uncertain extractions when needed.
10. Complete candidate legal acts are exported as CSV batches.

## Key Design Principle
RSS alert != sanctions delta. RSS alert == candidate legal act requiring classification.

RSS feed run != one new alert. A feed run reads a current feed window and relies on Legal Act Identity deduplication to separate newly discovered legal acts from already-seen ones.
