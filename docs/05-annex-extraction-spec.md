# Annex Extraction Specification

## Core Rule
Only treat a candidate legal act as a sanctions-list delta when the content indicates actual additions, amendments, removals, or replacements of listed persons/entities, usually in Annex sections.

For MVP, extraction uses English official source content. If English source content is not available yet, the candidate waits for retry instead of using another language automatically.

## Candidate Signals

Positive signals:

- Text contains `Annex` / `ANNEX`.
- Text says `the following persons and entities are added`.
- Text says `Annex I is amended`.
- Text says `the entries concerning the following persons are replaced`.
- Text references Regulation 269/2014 or another configured sanctions base act.
- Annex table/list contains person/entity records.

Negative or weak signals:

- General legal reasoning only.
- Corrigendum without name/entity changes.
- Extension of measures without list changes.
- Procedural update with no Annex.
- Duplicate publication already processed.

## Extraction Targets

Each extracted record should include an action type: `ADD`, `AMEND`, `REMOVE`, or `REPLACE`.

Replacement entries are exported as full listed-entry snapshots when the legal act provides the replacement entry. Removal entries may contain only the identifying details present in the legal act plus source metadata and evidence.

For natural persons:

- Full name
- Aliases / AKA
- Date of birth
- Place of birth
- Nationality
- Gender, if present
- Passport / ID numbers
- Function / position
- Grounds / reasons
- Listed date, if present
- Source CELEX ID
- Source document title
- Source publication date
- Source evidence text

For entities:

- Entity name
- Aliases
- Registration number
- Address
- Country
- Entity type
- Grounds / reasons
- Listed date, if present
- Source CELEX ID
- Source document title
- Source publication date
- Source evidence text

## Classification Statuses

```text
DETECTED
CONTENT_RETRIEVED
LANGUAGE_PENDING
NO_ANNEX_FOUND
ANNEX_FOUND_NO_NAMES
NO_DELTA
EXTRACTED_COMPLETE
NEEDS_EXTRACTION_CORRECTION
EXPORTED
REEXPORT_REQUIRED
FAILED_RETRIEVAL
FAILED_PARSING
```

Retrieval and language-pending states may retry automatically. Parsing failures require parser/rule changes and explicit reprocessing rather than endless automatic retry.

## Confidence Scoring

Confidence helps route candidates to extraction correction, but it does not by itself authorize export. Export requires complete extraction of the candidate legal act.

High confidence:

- Structured XML/table parsed successfully.
- Clear Annex section found.
- Name/entity rows are well delimited.
- Required fields are mapped.

Medium confidence:

- Annex found but formatting is inconsistent.
- Some fields missing.
- Records extracted from plain text.

Low confidence:

- Annex boundaries uncertain.
- Names detected but record grouping uncertain.
- Document language/format caused parsing ambiguity.

Clear no-delta cases may be classified automatically when the source content has strong negative evidence, such as no Annex and no add/amend/remove/replace language. Uncertain no-delta cases should be routed to correction or human confirmation rather than silently exported or discarded.

## Parser Approach

1. Prefer structured XML/Formex.
2. Use official English HTML/text fallback only when XML/Formex is unavailable, retaining evidence and source locations where possible.
3. Detect Annex boundaries.
4. Identify table/list structures.
5. Segment records.
6. Classify record as person or entity.
7. Extract fields with deterministic rules first; keep an interface for optional LLM-assisted parsing later.
8. Validate against schema.
9. Persist raw evidence for each extracted record.
10. Route incomplete or uncertain extraction results to extraction correction.

## Complete Extraction Gate

A candidate legal act has complete extraction when:

- English source content was retrieved.
- All relevant Annex boundaries were identified, or there is strong evidence that the candidate is no delta.
- Every detected listed-entry change is represented as a sanctions delta record.
- Each sanctions delta record has an action type, evidence text, source metadata, affected Annex when available, and record type.
- Unknown action type routes the candidate to extraction correction before export.
- Unknown record type routes the candidate to extraction correction before export.
- Detected configured base act or regime should be captured when available, but missing regime metadata does not block export unless a downstream target requires it.
- Manually added records during extraction correction require evidence text or source location from the official source content, and the system must infer action type and record type from that selected source context.
- Suspected false-positive records are not removed manually; the candidate remains in extraction correction until parser rules are fixed and the candidate is reprocessed.
- Field corrections are allowed when the record itself is valid and the corrected value is supported by evidence text or source location.
- Action type corrections require parser/rule fixes and candidate reprocessing rather than manual field editing.
- Record type corrections require parser/rule fixes and candidate reprocessing rather than manual field editing.
- Required identity fields are present when the source provides them.
- Sparse removal entries are allowed when the legal act provides only minimal identifying details.
- Countable Annex tables or lists must have matching extracted-record counts.
- Duplicate extraction artifacts should be deduplicated by source location/evidence, not by name alone.
- Parser validation has no unresolved errors.

## Important Control
Never export a partial candidate legal act in MVP. Export all sanctions delta records for a candidate legal act together only after extraction is complete.
