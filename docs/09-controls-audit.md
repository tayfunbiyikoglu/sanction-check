# Controls and Audit Requirements

## Control Objectives

- Avoid false assumption that RSS alert equals sanctions delta.
- Ensure official source traceability.
- Ensure complete extraction before export.
- Maintain reproducible extraction results.
- Provide audit trail for compliance and model/parser changes.

## Required Audit Evidence

For each exported record, retain:

- RSS/search source that triggered detection
- CELEX ID / CELLAR ID / source URL
- Official document title and publication date
- Raw retrieved metadata/content reference
- Parser version
- Extracted field values
- Evidence text from Annex
- Confidence score
- Correction actor when extraction was corrected
- Correction timestamp when extraction was corrected
- Export batch ID and file hash
- Watch query and configured base act changes

Audit events are append-only. Correction actions, export batch creation, download events, monitor runs, retrieval attempts, and reprocessing events should be recorded as new events rather than mutating prior history.

## Operational Controls

- Hourly job health monitoring
- Alert when retrieval fails repeatedly
- Alert when parsing fails
- Alert when no successful run occurs within defined SLA
- Alert when English source content remains pending beyond threshold
- API rate limit/error tracking
- Parser version tracking
- Manual override notes
- Actor fields stored as user ID/email strings for later SSO integration
- Application logs should use IDs, counts, statuses, and errors rather than dumping extracted names, dates of birth, identifiers, addresses, or evidence text.

Initial configurable defaults:

- No successful monitor run for 2 hours.
- Retrieval failed 3 consecutive times.
- English source content pending for 24 hours.

MVP alerts are dashboard-visible operational alerts. External notification channels can be added later.

## Compliance Positioning

This service is an early-warning and delta preparation control. It does not replace the official consolidated sanctions list or the bank's sanctioned-party screening provider.

## Retention

Audit artifacts, source content references, extraction results, correction actions, and export batches are retained indefinitely for MVP unless a bank retention policy requires otherwise. Configurable retention can be added once compliance provides a retention schedule.

MVP does not support manual deletion of source content or export batches through the dashboard.

## Risk Areas

- Incorrect parsing of Annex records
- Legal act language/format variability
- Duplicates across publications/corrigenda
- Amendments versus additions confusion
- Export format mismatch with downstream PTM upload requirements

## Mitigations

- Complete-extraction gate before CSV export
- Exact evidence text shown to users
- Store raw official source content outside relational tables with immutable references and hashes in PostgreSQL
- Version parsers and extraction rules
- Maintain no-delta and correction history to tune classifier
