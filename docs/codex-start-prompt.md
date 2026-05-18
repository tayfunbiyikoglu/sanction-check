# Codex Start Prompt

We are building a sanctions delta detection dashboard for a bank compliance use case.

Context:
The bank's PTM provider updates consolidated sanctions lists within 24 hours, but compliance wants earlier visibility when new EU sanctions legal acts are published on EUR-Lex. EUR-Lex RSS alerts may detect relevant legal acts, but an RSS alert does not always mean there is a new sanctions-list activity. Actual new/changed persons or entities are usually published under Annex sections. Therefore the system must treat RSS/search hits as candidate legal acts and classify/extract Annex content before creating a sanctions delta.

Build an MVP application with these capabilities:

1. Hourly monitoring job for configured EUR-Lex RSS feeds/search queries.
2. Candidate legal act deduplication using CELEX ID, then CELLAR ID, then official document URI.
3. Official content retrieval abstraction for EUR-Lex Web Service and CELLAR REST API. For now, create mock adapters and clear interfaces.
4. Candidate classifier that determines whether the document likely contains sanctions-list Annex changes.
5. Annex extraction pipeline that extracts persons/entities from Annex sections, with evidence text and confidence.
6. Dashboard where users can inspect candidates, view Annex evidence, and correct incomplete or uncertain extractions.
7. CSV export for complete candidate legal acts only, exported all at once as audit batches.
8. Audit trail for detection, extraction, correction, re-export, and export downloads.

Implementation stack:

- Use Node.js and TypeScript across the application.
- Use a TypeScript workspace with separate API, web, and shared domain packages.
- Use PostgreSQL for persistence.
- Use React/TypeScript for the Evidence Workbench dashboard.

Important design rules:

- Do not crawl EUR-Lex pages.
- RSS alert equals candidate only, not confirmed sanctions delta.
- Prefer XML/Formex content when available.
- Use English source content for MVP extraction; wait/retry if English is unavailable.
- Store raw source references and evidence text.
- Do not use approval/rejection statuses; official Annex inclusion determines listing, while users only correct extraction.
- Never export a partial candidate legal act in MVP.
- Keep parser versioning and audit logs.

Start by creating:

- A clean project structure.
- Database schema/migrations based on the data model docs.
- Mock data and mock EUR-Lex/CELLAR adapters.
- Dashboard UI following the Evidence Workbench design direction in `docs/07-dashboard-ui-brief.md` and `docs/dashboard-ui-evidence-workbench.png`, covering monitoring overview, candidate list, candidate detail, extraction correction, and export center.
- Backend API endpoints needed by the UI.
- Basic tests for candidate deduplication, Annex detection, complete-extraction gating, and CSV export.

Use the accompanying markdown documents as product and technical requirements.
