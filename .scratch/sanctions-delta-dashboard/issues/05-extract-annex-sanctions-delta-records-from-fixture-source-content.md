Status: completed

# Extract Annex Sanctions Delta Records From Fixture Source Content

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Build deterministic fixture-backed extraction for Annex sanctions delta records. Focus on official-shape fixtures rather than live EUR-Lex complexity: Annex boundaries, source order, source location, action type, person/entity record type, evidence text, sparse removals, replacement snapshots, amendments, and validation blockers.

## Acceptance criteria

- [ ] Parser extracts ADD, AMEND, REMOVE, and REPLACE sanctions delta records from fixtures.
- [ ] Replacement entries are represented as full replacement snapshots.
- [ ] Removal entries can be sparse when the source is sparse.
- [ ] Records include source order, source location, affected Annex, evidence text, action type, and record type.
- [ ] Tests cover count mismatches, duplicate source rows, duplicate-looking names, and unsupported structures.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/04-classify-candidate-legal-acts-as-delta-no-delta-or-correction-needed.md
