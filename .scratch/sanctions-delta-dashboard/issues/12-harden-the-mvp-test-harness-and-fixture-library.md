Status: completed

# Harden the MVP Test Harness and Fixture Library

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Consolidate fixture documents and behavior tests across identity, monitoring, retrieval, classification, parsing, complete extraction, correction policy, export determinism, audit events, and dashboard/API workflows.

## Acceptance criteria

- [ ] Fixture library covers the official-shape cases required by the PRD.
- [ ] Test harness runs consistently across API, web, and shared domain packages.
- [ ] Behavior tests avoid brittle private implementation assertions.
- [ ] Tests cover the main happy paths and guardrails from the previous slices.
- [ ] Typecheck, tests, and build pass.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/02-deduplicate-discovery-triggers-by-legal-act-identity.md
- .scratch/sanctions-delta-dashboard/issues/03-store-official-english-source-content-by-immutable-reference.md
- .scratch/sanctions-delta-dashboard/issues/04-classify-candidate-legal-acts-as-delta-no-delta-or-correction-needed.md
- .scratch/sanctions-delta-dashboard/issues/05-extract-annex-sanctions-delta-records-from-fixture-source-content.md
- .scratch/sanctions-delta-dashboard/issues/06-enforce-the-complete-extraction-gate.md
- .scratch/sanctions-delta-dashboard/issues/07-support-source-backed-extraction-correction.md
- .scratch/sanctions-delta-dashboard/issues/08-export-one-immutable-audit-csv-batch-per-complete-candidate.md
