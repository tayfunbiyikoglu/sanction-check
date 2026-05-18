Status: ready-for-agent

# PRD: Sanctions Delta Detection Dashboard

## Problem Statement

Compliance wants earlier visibility into EU sanctions-list changes than the bank's downstream post-transaction monitoring provider can guarantee. EUR-Lex RSS/search results can surface potentially relevant legal acts quickly, but a discovery trigger is not a sanctions delta. The bank needs a controlled workflow that distinguishes candidate legal acts from actual Annex-based listed-entry changes, extracts the resulting sanctions delta records with evidence, and produces an audit-friendly CSV export before the consolidated provider catches up.

The current risk is two-sided: treating every EUR-Lex alert as a delta creates false positives, while waiting for downstream consolidated lists delays operational awareness. The product must preserve official source traceability, avoid web crawling, support extraction correction without creating an approval workflow, and export only complete candidate legal acts.

## Solution

Build an MVP Sanctions Delta Detection Dashboard that runs hourly monitoring against configured EUR-Lex RSS/search queries, deduplicates candidate legal acts by legal act identity, retrieves official English source content through supported EUR-Lex/CELLAR integrations, classifies whether the source contains Annex-based sanctions-list changes, extracts sanctions delta records, and presents them in a dense Evidence Workbench dashboard.

The system exports one immutable audit CSV batch per candidate legal act after complete extraction. It does not support per-record approval/rejection, partial exports, or manual deletion of suspected false positives. Users may perform extraction correction only when it is source-backed: correcting extracted fields or adding missed records from selected source context. Parser-owned mistakes such as false positives, wrong delta actions, or wrong person/entity classifications require parser/rule fixes and explicit reprocessing.

The MVP uses PostgreSQL for relational persistence, stores source content outside PostgreSQL by immutable reference and hash, keeps audit events append-only, and generates an audit-friendly intermediate CSV rather than a final PTM-specific upload file.

## User Stories

1. As a compliance analyst, I want candidate legal acts to be detected hourly, so that I can see potential EU sanctions changes before downstream consolidated lists update.
2. As a sanctions operations user, I want RSS/search results treated only as discovery triggers, so that alert summaries are not mistaken for official sanctions deltas.
3. As a compliance analyst, I want each candidate legal act deduplicated by CELEX ID, CELLAR ID, or official document URI, so that repeated feeds and overlapping monitor windows do not create duplicate work.
4. As a financial crime technology user, I want monitoring to use an overlapping monitor window, so that indexing delays or reordered EUR-Lex results do not cause missed documents.
5. As a control owner, I want every monitor run recorded with query snapshot, items seen, new candidates, status, and errors, so that monitoring coverage can be audited.
6. As a compliance analyst, I want configured base acts and watch queries seeded for the MVP, so that the monitor can start with Regulation 269/2014 while supporting additional base acts later.
7. As an audit owner, I want watch query and configured base act changes audited, so that we can explain what the system was configured to watch at any point in time.
8. As a compliance analyst, I want official source content retrieved through EUR-Lex/CELLAR APIs, so that extraction is based on supported official integration channels rather than crawling.
9. As a control owner, I want source content retained by immutable reference and content hash, so that extraction decisions can be reproduced later.
10. As a compliance analyst, I want the MVP to use English source content only, so that extracted fields, grounds text, and evidence are consistent.
11. As a sanctions operations user, I want a candidate to become language pending when English source content is unavailable, so that we wait/retry instead of falling back silently to another language.
12. As a compliance analyst, I want retrieval failures to retry with backoff, so that transient EUR-Lex/CELLAR issues do not immediately create manual work.
13. As an operations user, I want repeated retrieval failures surfaced in the dashboard, so that broken integrations can be acted on.
14. As a compliance analyst, I want parsing failures to remain visible until parser/rule changes are made, so that unsupported document structures are not retried endlessly.
15. As a compliance analyst, I want clear no-delta cases classified automatically, so that obviously non-exportable legal acts do not clutter correction workflows.
16. As a compliance analyst, I want uncertain no-delta cases available for no-delta confirmation, so that a human can resolve ambiguous source content without calling it irrelevant.
17. As a sanctions operations user, I want no-delta to mean no add, amend, remove, or replace listed entries, so that legal relevance is not confused with exportability.
18. As a compliance analyst, I want Annex boundaries detected in official source content, so that extraction focuses on listed-entry changes rather than general legal reasoning.
19. As a compliance analyst, I want additions, amendments, removals, and replacements all represented as sanctions delta records, so that the MVP covers the real change types found in Annexes.
20. As a sanctions operations user, I want replacement entries exported as full replacement snapshots, so that downstream teams receive the full entry published by the legal act.
21. As a sanctions operations user, I want removal entries allowed to be sparse, so that removals can be exported even when the legal act provides only minimal identifying details.
22. As a compliance analyst, I want amendment entries to preserve the shape of the legal act, so that the system does not invent a full snapshot when the source only provides changed text.
23. As a control owner, I want every sanctions delta record to retain evidence text or source location, so that every exported row can be traced back to official source content.
24. As a compliance analyst, I want source order preserved in extracted records and CSV exports, so that I can compare exports directly against the Annex.
25. As a compliance analyst, I want similar names kept as separate records unless they are duplicate parses of the same source location, so that name-based deduplication does not merge distinct listed entries.
26. As a compliance analyst, I want record type to be PERSON or ENTITY before export, so that downstream interpretation is not ambiguous.
27. As a compliance analyst, I want delta action to be ADD, AMEND, REMOVE, or REPLACE before export, so that downstream handling is clear.
28. As a compliance analyst, I want unknown action type or record type to block complete extraction, so that incomplete classification does not reach export.
29. As a compliance analyst, I want countable Annex tables/lists validated against extracted record counts, so that missed rows block export.
30. As a compliance analyst, I want confidence stored but not used alone to authorize export, so that a high score cannot bypass the complete-extraction gate.
31. As a sanctions operations user, I want complete extraction to be required before export, so that no candidate legal act is partially exported.
32. As a compliance analyst, I want extraction correction for incomplete or inaccurate extraction fields, so that source-backed cleanup can happen before export.
33. As a compliance analyst, I want to add a missing sanctions delta record only from selected source evidence, so that manual additions remain tied to the official legal act.
34. As a compliance analyst, I want the system to infer action type and person/entity classification for added records from selected source context, so that users cannot create free-form unsourced records.
35. As a parser maintainer, I want false-positive records to require parser/rule fixes and reprocessing, so that the UI does not hide extraction defects.
36. As a parser maintainer, I want wrong delta actions and wrong person/entity classifications to require parser/rule fixes, so that core classification remains reproducible.
37. As a compliance analyst, I want field corrections to be audited with before/after values and actor, so that human corrections remain traceable.
38. As a compliance analyst, I want explicit reprocessing when parser logic changes, so that older extraction results are stable until intentionally rerun.
39. As a compliance analyst, I want parser version shown on extraction results, so that I can identify candidates extracted with older logic.
40. As a sanctions operations user, I want an exported candidate to become re-export required when reprocessing changes the current complete extraction, so that stale exports are visible.
41. As a control owner, I want re-export to create a new immutable export batch with a required reason, so that earlier exports are never overwritten or cancelled.
42. As a sanctions operations user, I want duplicate export prevention for already exported candidate legal acts, so that accidental duplicate CSVs are avoided.
43. As a sanctions operations user, I want export batches to include all sanctions delta records for exactly one candidate legal act, so that each CSV represents a complete official act.
44. As a sanctions operations user, I want an audit-friendly intermediate CSV, so that source-rich data can be reviewed before a final PTM-specific mapping exists.
45. As an audit owner, I want the CSV to include evidence text, source order, source location, affected Annex, detected base act when available, source metadata, and export batch ID, so that the exported file is self-explanatory.
46. As a control owner, I want file hashes and extraction snapshot hashes stored for export batches, so that file integrity and export freshness can be verified.
47. As a control owner, I want snapshot hashes based on stable export-relevant content, so that irrelevant operational metadata does not trigger false re-export requirements.
48. As an audit owner, I want download events tracked separately from export batch creation, so that access can be audited without changing batch identity.
49. As an audit owner, I want audit events append-only, so that monitor runs, retrieval attempts, correction actions, reprocessing, exports, and downloads preserve history.
50. As a compliance analyst, I want the Evidence Workbench dashboard to be candidate-centered, so that I work from candidate legal acts rather than record approval queues.
51. As a compliance analyst, I want a candidate queue grouped by processing status, so that I can quickly find needs-correction, ready-for-export, language-pending, failed, no-delta, exported, and re-export-required candidates.
52. As a compliance analyst, I want a source evidence viewer beside extracted records, so that I can compare the official English Annex against extracted fields.
53. As a compliance analyst, I want the complete-extraction gate visible in the dashboard, so that I understand why a candidate can or cannot be exported.
54. As a sanctions operations user, I want export readiness shown near parser version and snapshot hash, so that operational decisions are grounded in extraction state.
55. As a compliance analyst, I want no approve/reject controls in the UI, so that official Annex inclusion is not mistaken for a sanction approval workflow.
56. As an operations user, I want dashboard counters for last successful run, candidates today, needs correction, ready for export, export batches today, and failures, so that system health is visible.
57. As an operations user, I want dashboard-visible alerts for stale monitor runs, repeated retrieval failures, parsing failures, and language-pending candidates over threshold, so that problems are surfaced without external alerting in MVP.
58. As a financial crime technology user, I want local trusted prototype users with actor strings stored on audit events, so that the MVP is ready for later SSO without implementing auth now.
59. As a developer, I want a job/worker abstraction that can run in-process locally, so that the MVP can start simple while preserving a boundary for future queues.
60. As a developer, I want deterministic XML/Formex-first parsing with official English HTML/text fallback, so that extraction is reproducible but not blocked when structured content is unavailable.
61. As a developer, I want LLM-assisted parsing behind a later interface, so that future assistance can be added without changing the core parser contract.
62. As a developer, I want PostgreSQL persistence from the start, so that audit metadata, JSON fields, immutable batches, and eventual concurrency have a durable store.
63. As an operator, I want logs to avoid dumping extracted names, dates of birth, identifiers, addresses, or evidence text, so that ordinary logs do not overexpose sensitive operational data.
64. As an audit owner, I want source content, extraction results, correction actions, and export batches retained indefinitely for MVP unless policy says otherwise, so that audit artifacts are not deleted prematurely.
65. As a compliance analyst, I want no manual deletion of source content or export batches in the MVP dashboard, so that audit artifacts remain reliable.

## Implementation Decisions

- Build the system around the domain objects in the glossary: candidate legal act, sanctions delta record, listed entry, export batch, re-export, source content, evidence text, complete extraction, extraction correction, no delta, delta action, configured base act, watch query, and monitor window.
- Treat discovery triggers as non-authoritative. RSS/search results discover candidate legal acts but cannot produce sanctions delta records without official source content.
- Use legal act identity for deduplication: CELEX ID when present, then CELLAR ID, then official document URI.
- Use an hourly monitor with an overlapping monitor window. The exact lookback is operational configuration, with an MVP default around 72 hours.
- Represent configured base acts separately from watch queries. Watch queries are discovery configuration; configured base acts are legal/regime targets.
- Store watch query snapshots on monitor runs so historical monitor behavior remains auditable after configuration changes.
- Seed/change watch queries and configured base acts through admin scripts for MVP, not through the dashboard.
- Audit configuration changes to watch queries and configured base acts.
- Retrieve official source content through supported EUR-Lex/CELLAR integration channels. Do not crawl EUR-Lex web pages.
- Use English source content for MVP extraction and export. If English is unavailable, mark the candidate language pending and retry instead of falling back automatically.
- Store source content outside the main PostgreSQL relational tables. PostgreSQL stores immutable references, hashes, retrieval metadata, and audit records.
- Use deterministic XML/Formex-first parsing, with official English HTML/text fallback when structured content is unavailable and evidence/source locations can still be retained.
- Keep LLM-assisted parsing out of the initial implementation, behind a future parser interface.
- Classify candidates into explicit processing states including detected, content retrieved, language pending, no delta, extracted complete, needs extraction correction, retrieval failed, parsing failed, exported, and re-export required.
- Support delta actions ADD, AMEND, REMOVE, and REPLACE. Do not export unknown action types.
- Treat replacement entries as full listed-entry snapshots, not field-level diffs.
- Treat removal entries as potentially sparse when the source provides only minimal identifying details.
- Preserve amendment entries in the shape provided by the legal act: changed text when only changed text is published, or a full revised entry when the act provides one.
- Require complete extraction before export. Complete extraction means English source content was retrieved, relevant Annex boundaries were resolved or strong no-delta evidence exists, every detected listed-entry change is represented, each record has action type, record type, evidence, source metadata, and required source-provided identity fields, countable structures match extracted counts, and parser validation has no unresolved errors.
- Allow field-level extraction correction only when the sanctions delta record itself is valid and the corrected value is backed by evidence.
- Allow adding missed records only from selected source evidence, with delta action and person/entity classification inferred by the system from source context.
- Do not allow users to manually remove suspected false positives. Resolve false positives by parser/rule fixes and explicit candidate reprocessing.
- Do not allow users to manually change delta action or person/entity classification. Resolve those errors by parser/rule fixes and reprocessing.
- Store correction actions with actor, timestamp, before/after values, and optional comment.
- Use explicit reprocessing when parser rules change. Do not automatically rewrite old candidate extraction results.
- Mark candidates as re-export required when current complete extraction differs from the latest exported snapshot.
- Export one immutable audit CSV batch per candidate legal act after complete extraction. Do not allow partial record selection.
- Re-export creates a new immutable export batch, requires a reason, and links to the previous export batch. Do not mutate, cancel, or replace existing batches.
- Store file hash and extraction snapshot hash on export batches.
- Base extraction snapshot hash on candidate legal act identity, working language, parser/extraction version, ordered exported records, extracted fields, affected Annex, source metadata, and evidence/source location. Exclude download events, UI notes, unrelated timestamps, and CSV filename.
- Order CSV rows and snapshot records by source order: affected Annex order, source row/location order, and internal deterministic tie-breaker only as a last resort.
- Generate an audit-friendly intermediate CSV, not a final bank PTM upload schema. Include evidence text, affected Annex, detected base act when available, source order, source location, source metadata, and export batch ID.
- Track export download events separately from export batch creation.
- Keep audit events append-only across monitor runs, retrieval attempts, correction actions, reprocessing, export creation, download events, and configuration changes.
- Use PostgreSQL for MVP persistence.
- Use local filesystem storage for source content in the local MVP, through an abstraction that can later move to object storage.
- Use a job/worker abstraction from the start; local MVP may run jobs in-process before selecting a concrete queue.
- Use a local trusted prototype user for MVP and persist actor fields as strings for later SSO.
- Build the dashboard using the Evidence Workbench direction: dense, quiet, document-centric, candidate-centered, and without approve/reject controls.
- Major modules to build:
  - Monitoring module: scheduled monitor runs, watch query execution, overlap windows, deduplication, monitor run audit.
  - Configuration module: configured base acts, watch queries, query/base-act links, configuration change audit.
  - Source retrieval module: EUR-Lex search adapter, CELLAR retrieval adapter, source content storage abstraction, retrieval retry/backoff, language-pending handling.
  - Candidate store module: candidate processing state, legal act identity, source metadata, base act matches, reprocessing state.
  - Classification module: no-delta/delta classification, Annex signal detection, candidate state transitions.
  - Parser module: XML/Formex parser, HTML/text fallback, Annex boundary detection, row/list segmentation, record extraction, source order assignment, validation.
  - Extraction correction module: source-backed field correction, source-backed missing-record addition, correction audit, complete-extraction gate.
  - Export module: audit CSV generation, immutable export batches, re-export, file hash, extraction snapshot hash, source-order serialization, download audit.
  - Audit/control module: append-only events, operational alerts, parser version visibility, stale extraction indicators, logging constraints.
  - Evidence Workbench UI module: monitor overview, candidate queue, candidate detail, source evidence viewer, extraction correction, export batches, audit trail.
- Deep modules worth extracting with stable interfaces:
  - Legal act identity resolver: accepts source metadata and returns canonical dedupe identity.
  - Source content repository: stores/retrieves immutable content by reference and hash.
  - Candidate state machine: owns allowed status transitions from detection through export/re-export.
  - Annex extraction pipeline: accepts official source content and returns extraction result plus records, evidence, source locations, validation errors, and completeness.
  - Complete-extraction gate: accepts extraction result and validation context, returns export readiness and blocking reasons.
  - Export snapshot hasher: accepts exportable candidate records and returns stable hash.
  - Audit CSV serializer: accepts an exportable candidate snapshot and returns deterministic CSV bytes.
  - Correction policy: determines which correction actions are allowed and what must be reprocessed.

## Testing Decisions

- Tests should focus on externally observable behavior: state transitions, persisted records, exported CSV content, audit events, retry behavior, and UI-visible readiness. Avoid testing private implementation details or parser helper internals directly unless they are exposed as deep module contracts.
- Monitoring tests should verify hourly run behavior through the monitor service interface: watch query snapshots are captured, overlapping windows can rediscover candidates, duplicates merge by legal act identity, and monitor run counts/errors are recorded.
- Deduplication tests should cover CELEX-first identity, CELLAR fallback, URI fallback, and merging an RSS-discovered candidate with later official metadata.
- Source retrieval tests should use mock EUR-Lex/CELLAR adapters to verify official content retrieval, English-only selection, language-pending behavior, immutable content reference creation, content hash storage, retrieval retries, and surfaced failures.
- Classification tests should cover delta, no-delta, uncertain no-delta, no Annex, Annex without names, corrigendum with and without listed-entry changes, extension of measures without list changes, and replacement/amendment wording.
- Parser tests should use fixture documents for XML/Formex tables, HTML/text fallback, additions, replacements, amendments, removals, multiple Annexes, multiple configured base acts, sparse removals, duplicate names, duplicate source rows, and count mismatches.
- Complete-extraction gate tests should verify blocking conditions: missing English source content, unresolved Annex boundaries, missing record type, missing action type, count mismatch, parser validation error, suspected false positives, and missing required source-provided identity fields.
- Correction policy tests should verify allowed field corrections, source-backed missing-record addition, rejection of unsourced records, rejection of manual false-positive deletion, rejection of manual action type changes, and rejection of manual person/entity reclassification.
- Reprocessing tests should verify parser version visibility, explicit candidate reprocessing, preservation of historical extraction/export artifacts, and re-export-required state when current extraction differs from the latest exported snapshot.
- Export tests should verify one batch per candidate legal act, no partial export, deterministic source ordering, CSV columns, file naming, file hash, extraction snapshot hash, duplicate export prevention, re-export reason requirement, and immutable prior batches.
- Audit tests should verify append-only correction actions, monitor runs, retrieval attempts, configuration changes, export batch creation, re-export linkage, and download events.
- Dashboard/API tests should verify candidate-centered workflows: monitor overview counters, status filtering, candidate detail evidence display, complete-extraction gate blockers, extraction correction affordances, export readiness, re-export required state, and absence of approve/reject controls.
- Logging tests should verify that ordinary logs use IDs, counts, statuses, and errors rather than dumping extracted names, DOBs, identifiers, addresses, or evidence text.
- Good parser fixtures are central to the test suite. Keep them small, official-shape, and named by behavior rather than implementation.
- There is no prior production test suite in the repo yet; the first implementation should establish the test conventions alongside the skeleton.

## Out of Scope

- Replacing the official consolidated sanctions list.
- Fully automated production upload without extraction controls.
- Final PTM-specific CSV/upload schema mapping.
- Covering every global sanctions regime.
- Real-time monitoring below hourly cadence.
- Web crawling or scraping EUR-Lex pages.
- Automatic multilingual fallback when English source content is unavailable.
- Per-record approval/rejection workflow.
- Per-record review status.
- Partial export of selected records from a candidate legal act.
- Manual deletion of source content or export batches through the dashboard.
- Manual deletion of suspected false-positive extracted records.
- Manual action type or person/entity classification edits.
- Watch query/configured base act management UI.
- Bank SSO implementation.
- External alerting channels beyond dashboard-visible operational alerts.
- Automatic backfill/reprocessing of all old candidates after parser changes.
- LLM-assisted extraction in the first implementation.
- Configurable retention/deletion policy before compliance provides a retention schedule.

## Further Notes

- The Evidence Workbench mockup is the preferred visual reference for the MVP dashboard. Implementation should preserve its candidate-centered, three-pane, document-centric feel rather than producing a marketing-style interface.
- The first useful implementation slice should seed one delta candidate, one no-delta candidate, and one needs-correction candidate; mock English source content retrieval; classify and extract against fixtures; enforce complete extraction before export; and generate one audit CSV batch for a complete candidate legal act.
- The PRD intentionally uses the project glossary vocabulary. Avoid reintroducing older terms such as approved record, review item, partial export, rejected candidate, or RSS alert as sanctions delta.
- Existing ADRs are binding for this PRD: retain source/evidence, export complete candidate legal acts as immutable batches, use English source content, keep correction source-backed and parser-owned, export audit intermediate CSV, use PostgreSQL, store source content by reference outside PostgreSQL, and use deterministic XML-first parsing before LLM assistance.
