# Product Brief

## Working Name
Sanctions Delta Detection Dashboard

## Business Context
The bank's current post-transaction monitoring provider guarantees sanctions list updates within 24 hours. Compliance wants earlier visibility when newly sanctioned persons/entities are first published through EUR-Lex legal acts, before the consolidated sanctions lists are updated by downstream providers.

## Problem
EUR-Lex RSS/search alerts may identify relevant legal acts, but not every alert results in a new sanctions-list change. Actual additions or amendments are usually published in Annex sections. The system must distinguish between candidate legal acts and actual sanctions-list deltas.

## Objective
Create an hourly monitoring and extraction workflow that:

- Detects candidate EU sanctions legal acts from EUR-Lex RSS/search results.
- Retrieves official legal act content using supported EUR-Lex/CELLAR integration methods.
- Classifies whether the document contains sanctions-list Annex changes.
- Extracts names/entities and supporting metadata from Annex sections.
- Presents extracted deltas and evidence in a dashboard for inspection and correction.
- Exports complete candidate legal acts as audit-friendly CSV batches that can support downstream upload workflows.

## Target Users

- Compliance analysts
- Sanctions operations team
- Financial crime technology team
- Audit / control owners

## MVP Success Criteria

- Hourly job detects candidate legal acts without crawling EUR-Lex pages.
- Each candidate is deduplicated and stored with source metadata.
- System can classify whether candidate contains relevant Annex content.
- Extracted names/entities are shown with source evidence.
- Users can correct extraction errors before export.
- Complete candidate legal acts can be exported to CSV all at once.
- Audit trail captures source, extraction, correction, and export actions.

## Non-Goals for MVP

- Replacing the official consolidated sanctions list.
- Fully automated production upload without extraction controls.
- Covering every sanctions regime globally.
- Real-time streaming below hourly cadence.
- Web crawling or scraping EUR-Lex pages.
