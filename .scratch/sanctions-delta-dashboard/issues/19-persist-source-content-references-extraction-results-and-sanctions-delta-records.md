Status: completed

# Persist Source Content References, Extraction Results, and Sanctions Delta Records

## Parent

.scratch/postgresql-persistence/PRD.md

## What to build

Make the retrieval and extraction path durable after a Candidate Legal Act has been discovered. A completed slice should let the dashboard retrieve official English Source Content for a Candidate Legal Act, classify/extract it, restart the API, and still show the Candidate Legal Act with its Source Content reference, retrieval state, latest Extraction Result, and Sanctions Delta Records.

Source Content bytes must remain outside PostgreSQL by immutable reference and hash. PostgreSQL stores the reference metadata and retrieval state needed to audit and reproduce extraction behavior.

Extraction Results must be append-mostly. Each result stores the Source Content reference and hash it was produced from, and Sanctions Delta Records belong to the Extraction Result that produced them. If later retrieval finds different Source Content, the system must preserve existing Extraction Results and require explicit reprocessing instead of automatically overwriting records.

## Acceptance criteria

- [ ] Candidate Legal Acts persist Source Content reference metadata: reference, content hash, content length, content type, language, source URI, and retrieved timestamp.
- [ ] Candidate Legal Acts persist retrieval state: status, attempts, last attempt time, next retry time, available languages, source-content-changed flag, previous source content hash, failure code, and failure message.
- [ ] Source Content bytes remain outside PostgreSQL.
- [ ] Raw EUR-Lex search/RSS response bytes remain outside PostgreSQL.
- [ ] Extraction Results are persisted in PostgreSQL.
- [ ] Extraction Results store parser version, classification, confidence, Annex presence, Annex heading, completeness flag, evidence summary, created timestamp, and Source Content reference/hash used by that extraction.
- [ ] Extraction Results are append-mostly; reprocessing creates a new Extraction Result instead of mutating previous parser output.
- [ ] Sanctions Delta Records are persisted in PostgreSQL.
- [ ] Sanctions Delta Records are linked to the Extraction Result that produced them.
- [ ] Candidate detail shows the latest Extraction Result by default after restart.
- [ ] Older Extraction Results remain available for audit/control use even when a newer result exists.
- [ ] Changed Source Content marks the need for explicit reprocessing and does not automatically overwrite Extraction Results or Sanctions Delta Records.
- [ ] Changed Source Content alone does not mark Re-Export required unless reprocessing proves the exportable extraction changed.
- [ ] CELEX `32026R1055` can be discovered, retrieved from public CELLAR, classified, extracted into 23 Sanctions Delta Records, and still show complete extraction after API restart.
- [ ] Full typecheck, tests, and build pass.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/18-persist-monitoring-discovery-triggers-and-candidate-legal-acts.md
