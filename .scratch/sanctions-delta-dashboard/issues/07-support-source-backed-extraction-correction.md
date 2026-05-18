Status: completed

# Support Source-Backed Extraction Correction

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add extraction correction actions for source-backed field edits and missed-record additions, with correction audit history. Prevent manual false-positive deletion, manual action type changes, and manual person/entity reclassification.

## Acceptance criteria

- [ ] Users can correct extracted fields when the record itself is valid and evidence-backed.
- [ ] Users can add missed records only from source context that lets the system infer action type and person/entity classification.
- [ ] Correction actions are append-only and include actor, timestamp, before/after values, and comment when present.
- [ ] Manual false-positive deletion, action type edits, and person/entity reclassification are rejected.
- [ ] Tests cover allowed and rejected correction actions.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/06-enforce-the-complete-extraction-gate.md
