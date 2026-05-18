# Sanctions Delta Detection Dashboard — Kickoff Pack

This pack contains the initial documents to start implementation and iteration in Codex.

## Goal
Build an hourly EUR-Lex monitoring service that detects candidate EU sanctions legal acts, retrieves official English content via supported APIs, determines whether the act contains Annex-based sanctions-list changes, extracts listed persons/entities, and exports complete candidate legal acts as audit CSV batches.

## Documents

1. `01-product-brief.md` — Business context, goals, non-goals, users, success criteria.
2. `02-functional-requirements.md` — Core workflows and user-facing requirements.
3. `03-architecture.md` — Proposed system architecture and components.
4. `04-eurlex-integration.md` — EUR-Lex RSS / Web Service / CELLAR integration approach.
5. `05-annex-extraction-spec.md` — Content classification and Annex extraction rules.
6. `06-data-model.md` — Initial database entities and fields.
7. `07-dashboard-ui-brief.md` — UI screens and prototype ideas.
   - Preferred visual reference: `docs/dashboard-ui-evidence-workbench.png`
8. `08-csv-export-spec.md` — CSV structure and export behavior.
9. `09-controls-audit.md` — Compliance, auditability, and operational controls.
10. `10-implementation-backlog.md` — Suggested MVP backlog for Codex iterations.
11. `codex-start-prompt.md` — Prompt to paste into Codex as the starting instruction.

## MVP Principle
RSS alerts are only discovery triggers for candidate legal acts. They must not be treated as sanctions deltas until official source content is retrieved, classified, and Annex entries are extracted or the candidate is classified as no delta.

## Implementation Stack

The MVP uses Node.js and TypeScript across the API, dashboard, and shared domain modules, with PostgreSQL for persistence and React/TypeScript for the Evidence Workbench UI.

## Current Prototype Status

The local prototype can run the saved EUR-Lex RSS feed, retrieve official English Source Content from public CELLAR, classify/extract EUR-Lex XHTML Annex tables, and export complete Candidate Legal Acts. A proven live case is CELEX `32026R1055`, which extracts 23 Sanctions Delta Records from the Annex.

Persistence is the next implementation target. The running API still keeps operational state in memory, so PostgreSQL wiring should be the next slice before deeper workflow polish.
