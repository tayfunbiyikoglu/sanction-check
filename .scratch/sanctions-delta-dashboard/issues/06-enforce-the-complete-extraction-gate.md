Status: completed

# Enforce the Complete Extraction Gate

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add a reusable complete-extraction gate that determines whether a candidate legal act is ready to produce an export batch. Surface blockers through the API and Evidence Workbench without implementing export yet.

## Acceptance criteria

- [ ] Gate requires English source content, resolved Annex boundaries or no-delta evidence, action type, record type, evidence, source metadata, and no unresolved parser validation errors.
- [ ] Unknown action type or record type blocks readiness.
- [ ] Count mismatches and missing required source-provided identity fields block readiness.
- [ ] API returns readiness and blocker reasons for candidate detail.
- [ ] UI shows complete-extraction gate status and blockers.
- [ ] Tests cover all blocker categories and ready cases.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/05-extract-annex-sanctions-delta-records-from-fixture-source-content.md
