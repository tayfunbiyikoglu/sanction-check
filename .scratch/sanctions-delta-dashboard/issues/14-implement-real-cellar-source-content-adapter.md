Status: completed

# Implement Real CELLAR Source Content Adapter

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add a live CELLAR retrieval adapter that resolves official English Source Content from a Candidate Legal Act's best available Legal Act Identity. The adapter should discover available language manifestations first, store only English Source Content for MVP, and preserve immutable prior Source Content references when official content changes.

## Acceptance criteria

- [ ] CELLAR retrieval accepts a Candidate Legal Act and resolves content using CELEX ID, then CELLAR ID, then official document URI.
- [ ] Retrieval discovers available language manifestations before selecting content.
- [ ] English Source Content is selected when present; otherwise the candidate becomes a Language Pending Candidate with available languages recorded.
- [ ] English content format preference is XML/Formex, then HTML, then plain text.
- [ ] PDF is not used as MVP Source Content for extraction.
- [ ] Stored Source Content uses immutable reference, content hash, source URI, content type, content length, language, and retrieved timestamp.
- [ ] If official English content hash changes, the Candidate Legal Act advances to the new Source Content reference while prior references remain immutable audit artifacts.
- [ ] Changed Source Content creates explicit reprocessing need; it does not automatically rewrite extraction results.
- [ ] Retrieval failures produce safe operational metadata and dashboard-visible alerts without logging Source Content bytes or Evidence Text.
- [ ] Mock/recorded CELLAR fixtures remain available for normal tests.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/03-store-official-english-source-content-by-immutable-reference.md
- .scratch/sanctions-delta-dashboard/issues/09-handle-reprocessing-and-re-export-required-state.md
- .scratch/sanctions-delta-dashboard/issues/11-add-operational-audit-and-alert-visibility.md
- .scratch/sanctions-delta-dashboard/issues/13-implement-real-eurlex-search-adapter.md
