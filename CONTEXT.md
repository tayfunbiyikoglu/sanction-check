# Sanctions Delta Detection

This context describes the language for detecting EU sanctions-list changes from official legal acts and preparing those changes for downstream bank systems.

## Language

**Candidate Legal Act**:
An official EU legal act discovered from EUR-Lex RSS or search that may or may not contain sanctions-list changes.
_Avoid_: RSS alert, candidate record, sanctions delta

**Sanctions Delta Record**:
A single extracted person or entity change from an official legal act.
_Avoid_: Candidate, legal act, review item

**Listed Entry**:
A person or entity entry that appears in an official sanctions Annex.
_Avoid_: Approved record, review item

**Export Batch**:
A CSV export containing all sanctions delta records extracted from one candidate legal act.
_Avoid_: Partial export, approved-record export

**Affected Annex**:
The sanctions Annex section in which a listed entry change appears.
_Avoid_: Export batch, candidate legal act

**Configured Base Act**:
An EU sanctions base act that the monitor is configured to watch for related legal acts.
_Avoid_: Hard-coded regime, only Regulation 269/2014

**Legal Act Identity**:
The canonical identity of a candidate legal act, preferably CELEX ID, then CELLAR ID, then official document URI.
_Avoid_: Title, source URL, RSS item ID

**Source Content**:
The official legal act content retrieved through supported EUR-Lex or CELLAR integration.
_Avoid_: Crawled page, scraped content

**Evidence Text**:
The source fragment or location that supports a sanctions delta record.
_Avoid_: Parser explanation, reviewer note

**Audit Export**:
A CSV export that includes evidence text alongside extracted sanctions delta fields.
_Avoid_: Upload-only CSV, minimal export

**Re-Export**:
A new export batch for a candidate legal act that was exported before, created after correction or explicit operational need.
_Avoid_: Overwritten export, mutated CSV

**Discovery Trigger**:
A non-authoritative EUR-Lex RSS or search result that points to a possible candidate legal act.
_Avoid_: Source content, sanctions delta

**RSS Feed Run**:
A polling run against a configured EUR-Lex RSS feed that reads the feed's current result window and creates or refreshes Discovery Triggers.
_Avoid_: New-alert delivery, one-item push notification

**Search Response Reference**:
An immutable reference and hash for the raw response returned by a EUR-Lex search used in a monitor run.
_Avoid_: Source content, evidence text

**Monitor Window**:
The rolling time range used by a monitoring run to rediscover recent candidate legal acts.
_Avoid_: Last-run cursor, export period

**Working Language**:
The official language version used for extraction and export; English for MVP.
_Avoid_: Any available language, browser language

**Language Pending Candidate**:
A candidate legal act whose English source content is not yet available for extraction.
_Avoid_: Failed candidate, multilingual fallback

**Complete Extraction**:
The extracted sanctions delta records fully represent the listed entries in the candidate legal act.
_Avoid_: Partially approved, partially exported

**Extraction Correction**:
A human correction to make extracted records accurately represent the official Annex.
_Avoid_: Approval, review decision, sanction approval

**No Delta**:
A candidate legal act that does not add, amend, remove, or replace listed entries.
_Avoid_: Irrelevant act, non-sanctions act

**No-Delta Confirmation**:
A human correction confirming that a candidate legal act produces no sanctions delta records.
_Avoid_: Mark irrelevant, reject candidate

**Delta Action**:
The kind of sanctions-list change represented by a sanctions delta record: add, amend, remove, or replace.
_Avoid_: Review status, processing status

**Replacement Entry**:
A full listed-entry snapshot that replaces an existing sanctions-list entry.
_Avoid_: Field-level diff, patch

**Removal Entry**:
A listed-entry removal identified by the legal act, even when the source provides only minimal identifying details.
_Avoid_: Failed extraction, incomplete record

**Amendment Entry**:
A listed-entry change that preserves the shape of the legal act, either as changed text or a full revised entry.
_Avoid_: Replacement entry, invented full snapshot

## Relationships

- A **Candidate Legal Act** may produce zero, one, or many **Sanctions Delta Records**.
- A **Sanctions Delta Record** belongs to exactly one **Candidate Legal Act**.
- A **Sanctions Delta Record** represents one **Listed Entry** when the source legal act contains actual sanctions-list changes.
- An **Export Batch** contains all **Sanctions Delta Records** for exactly one **Candidate Legal Act**.
- A **Candidate Legal Act** must have a **Complete Extraction** before it can produce an **Export Batch**.
- A **Candidate Legal Act** may produce a **Re-Export**, but previous **Export Batches** remain immutable.
- **Extraction Correction** resolves an incomplete or inaccurate extraction before export.
- **Extraction Correction** may add a missing **Sanctions Delta Record** only when backed by **Evidence Text** from the **Source Content**, with **Delta Action** and person/entity classification inferred from the selected source context.
- Suspected false-positive **Sanctions Delta Records** are resolved by parser correction and reprocessing, not by manual removal.
- **Extraction Correction** may edit extracted fields when the **Sanctions Delta Record** itself is valid and the correction is supported by **Evidence Text**.
- Incorrect **Delta Action** values are resolved by parser correction and reprocessing.
- Incorrect person/entity classification is resolved by parser correction and reprocessing.
- A **Candidate Legal Act** classified as **No Delta** produces no **Sanctions Delta Records**.
- **No-Delta Confirmation** is used for uncertain cases; clear **No Delta** cases may be classified automatically.
- Each **Sanctions Delta Record** has exactly one **Delta Action**.
- A **Sanctions Delta Record** with a replace **Delta Action** represents a full **Replacement Entry**, not a field-level difference.
- A **Sanctions Delta Record** with a remove **Delta Action** may represent a sparse **Removal Entry**.
- A **Sanctions Delta Record** with an amend **Delta Action** represents an **Amendment Entry** in the form provided by the legal act.
- A **Candidate Legal Act** can have one or more **Affected Annexes**.
- A **Sanctions Delta Record** may identify the **Affected Annex** it came from.
- A **Candidate Legal Act** may relate to one or more **Configured Base Acts**.
- A **Candidate Legal Act** has one **Legal Act Identity** used for deduplication.
- A **Candidate Legal Act** has **Source Content** when official content retrieval succeeds.
- A **Candidate Legal Act** may advance to a newer **Source Content** reference if official retrieved content changes, while prior source references remain immutable audit artifacts.
- Changed **Source Content** creates a need for explicit reprocessing; it does not automatically rewrite existing extraction results.
- A **Sanctions Delta Record** has **Evidence Text** showing why it exists.
- Similar names in the same **Candidate Legal Act** remain separate **Sanctions Delta Records** unless they are duplicate parses of the same source location.
- An **Export Batch** is an **Audit Export** for MVP.
- A **Discovery Trigger** can discover a **Candidate Legal Act**, but cannot by itself produce **Sanctions Delta Records**.
- An **RSS Feed Run** may return many current feed items, including already-seen legal acts; the system deduplicates them by **Legal Act Identity**.
- An **RSS Feed Run** must not be interpreted as a push containing only newly published alerts.
- EUR-Lex search results produce **Discovery Triggers** and candidate metadata; they do not produce **Source Content** for extraction.
- A search adapter returns **Discovery Triggers**; candidate creation and merging happen separately through **Legal Act Identity** deduplication.
- A **Search Response Reference** supports monitor audit; it is not **Source Content** and is not used as **Evidence Text**.
- A **Monitor Window** may rediscover existing **Candidate Legal Acts** that are merged by **Legal Act Identity**.
- **Source Content** is extracted using the **Working Language**.
- A **Candidate Legal Act** becomes a **Language Pending Candidate** when official source content exists only outside the **Working Language**.

## Example dialogue

> **Dev:** "Can we mark this **Candidate Legal Act** as approved for export?"
> **Domain expert:** "No — the **Candidate Legal Act** is only the source. Export decisions apply to the extracted **Sanctions Delta Records**."

## Flagged ambiguities

- "candidate" was used for both source legal acts and extracted records — resolved: **Candidate Legal Act** is the source document; **Sanctions Delta Record** is the extracted person or entity change.
- "approved" was used to describe Annex-listed names — resolved: a **Listed Entry** is already official because it appears in the Annex; analysts are not approving the sanction itself.
- "export approved records" implied record-level selection — resolved: exports happen all at once per **Candidate Legal Act**.
- "partial export" was considered for confident extracted records — resolved: a **Candidate Legal Act** is exported only after **Complete Extraction**.
- "review" and "approval" were used for analyst actions — resolved: the domain action is **Extraction Correction**, because the official Annex already determines whether an entry is listed.
