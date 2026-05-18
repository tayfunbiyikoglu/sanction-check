Status: completed

# Add Operational Audit and Alert Visibility

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add append-only audit and dashboard-visible operational alerts for monitor runs, retrieval attempts, parsing failures, correction actions, export batches, downloads, configuration changes, stale monitor runs, repeated failures, and language-pending thresholds.

## Acceptance criteria

- [ ] Audit events are append-only and visible through API/UI.
- [ ] Monitor runs, retrieval attempts, correction actions, export creation, downloads, reprocessing, and configuration changes are represented.
- [ ] Dashboard-visible alerts cover stale monitor runs, repeated retrieval failures, parsing failures, and language-pending candidates over threshold.
- [ ] Logs avoid dumping extracted names, dates of birth, identifiers, addresses, or evidence text.
- [ ] Tests cover audit event creation and alert threshold behavior.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/01-persist-candidate-legal-acts-from-seeded-watch-queries.md
- .scratch/sanctions-delta-dashboard/issues/03-store-official-english-source-content-by-immutable-reference.md
- .scratch/sanctions-delta-dashboard/issues/04-classify-candidate-legal-acts-as-delta-no-delta-or-correction-needed.md
- .scratch/sanctions-delta-dashboard/issues/08-export-one-immutable-audit-csv-batch-per-complete-candidate.md
