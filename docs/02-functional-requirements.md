# Functional Requirements

## FR-001 Hourly Candidate Detection
The system shall run a recurring job every hour to check configured EUR-Lex RSS feeds and/or saved search queries.

## FR-002 Source Deduplication
The system shall deduplicate candidate legal acts using CELEX ID when present, then CELLAR ID, then official document URI as fallback.

## FR-003 Official Content Retrieval
The system shall retrieve official document metadata and content through supported EUR-Lex/CELLAR APIs, not through crawling.

English source content shall be used for MVP extraction and export. If English source content is not available yet, the candidate shall wait for retry rather than falling back to another language automatically.

## FR-004 Candidate Processing State
The system shall track candidate legal acts using processing states such as:

- Detected
- Content retrieved
- Language pending
- No delta
- Extracted complete
- Needs extraction correction
- Retrieval failed
- Parsing failed
- Exported
- Re-export required

## FR-005 Annex Detection
The system shall detect whether the document contains Annex sections likely to include persons/entities added to or removed from sanctions lists.

## FR-006 Annex Extraction
The system shall extract structured records from Annex sections when listed persons or entities are present.

Additions, amendments, removals, and replacements shall all be treated as sanctions delta records. Replacements shall be exported as full replacement entries; removals may contain sparse identifying data when the source provides only minimal details.

## FR-007 Evidence Capture
The system shall store the exact source text fragment or document location supporting each extracted record.

## FR-008 Dashboard Visibility
Users shall be able to view candidate legal acts, extracted records, source evidence, extraction confidence, processing status, and export batches.

## FR-009 Extraction Correction
Users shall be able to correct extraction errors when the system cannot produce a complete extraction for a candidate legal act.

## FR-010 CSV Export
Users shall be able to export all extracted sanctions delta records for a candidate legal act as one CSV export batch once extraction is complete.

## FR-011 Audit Trail
The system shall record candidate detection time, source document, extraction version, extraction corrections, export timestamp, exported file reference, file hash, and evidence text.

## FR-012 Reprocessing
Authorized users shall be able to explicitly reprocess a candidate document when extraction logic changes.

The system shall store parser version on extraction results and show when a candidate was extracted with an older parser version.
