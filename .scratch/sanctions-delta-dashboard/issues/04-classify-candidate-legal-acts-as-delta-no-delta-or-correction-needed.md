Status: completed

# Classify Candidate Legal Acts as Delta, No Delta, or Correction Needed

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Classify candidate legal acts from fixture source content into delta, no delta, uncertain/no-delta confirmation, parsing failure, or needs extraction correction states. Surface classification state and operational counters through the API and Evidence Workbench.

## Acceptance criteria

- [ ] Clear no-delta cases can be classified automatically.
- [ ] Uncertain no-delta and parsing failure cases are visible and auditable.
- [ ] Candidate processing states transition through the application layer.
- [ ] Dashboard counters include no-delta, needs correction, failures, and ready-for-export candidates.
- [ ] Tests cover delta, no-delta, uncertain no-delta, no Annex, and parsing failure fixtures.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/03-store-official-english-source-content-by-immutable-reference.md
