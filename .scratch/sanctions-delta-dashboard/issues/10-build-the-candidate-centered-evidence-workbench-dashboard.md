Status: completed

# Build the Candidate-Centered Evidence Workbench Dashboard

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Replace the static UI shell with an API-backed Evidence Workbench: monitor overview counters, candidate queue, candidate detail, source evidence viewer, extracted-record panel, complete-extraction gate, export readiness, and export batch views.

## Acceptance criteria

- [ ] Dashboard uses the Evidence Workbench design direction and remains candidate-centered.
- [ ] Candidate queue groups and filters candidate legal acts by processing status.
- [ ] Candidate detail shows source evidence, extracted records, complete-extraction gate, parser version, and export readiness.
- [ ] Export batch views show immutable batches, hashes, record counts, and download affordances.
- [ ] No approve/reject controls or per-record review statuses appear in the UI.
- [ ] UI tests or integration tests cover the main candidate-centered workflows.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/01-persist-candidate-legal-acts-from-seeded-watch-queries.md
- .scratch/sanctions-delta-dashboard/issues/03-store-official-english-source-content-by-immutable-reference.md
- .scratch/sanctions-delta-dashboard/issues/06-enforce-the-complete-extraction-gate.md
- .scratch/sanctions-delta-dashboard/issues/08-export-one-immutable-audit-csv-batch-per-complete-candidate.md
