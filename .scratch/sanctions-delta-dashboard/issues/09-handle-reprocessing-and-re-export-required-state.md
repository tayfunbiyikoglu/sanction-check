Status: completed

# Handle Reprocessing and Re-Export Required State

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add explicit candidate reprocessing, parser version visibility, extraction snapshot comparison, re-export-required state, and reason-required re-export for candidates whose current complete extraction differs from the latest export batch.

## Acceptance criteria

- [ ] Users can explicitly reprocess a candidate legal act after parser/rule changes.
- [ ] Parser version is visible on extraction results and candidate detail.
- [ ] Reprocessing preserves historical extraction/export artifacts.
- [ ] Candidate becomes re-export required when current extraction snapshot differs from latest export.
- [ ] Re-export requires a reason and creates a new immutable export batch linked to the previous batch.
- [ ] Tests cover unchanged and changed extraction snapshots.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/05-extract-annex-sanctions-delta-records-from-fixture-source-content.md
- .scratch/sanctions-delta-dashboard/issues/08-export-one-immutable-audit-csv-batch-per-complete-candidate.md
