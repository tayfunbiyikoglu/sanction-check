Status: completed

# Add Live Integration Configuration and Safe Toggles

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add explicit configuration for independently switching EUR-Lex search and CELLAR Source Content retrieval between mock and live modes. Live mode must fail affected operations clearly when required endpoint or credential configuration is missing, and must never silently fall back to mock mode.

## Acceptance criteria

- [x] `EURLEX_SEARCH_MODE=mock|live` controls whether monitor runs use mock/recorded search responses or live EUR-Lex Web Service search.
- [x] `CELLAR_RETRIEVAL_MODE=mock|live` controls whether Source Content retrieval uses mock/recorded CELLAR content or live CELLAR retrieval.
- [x] Search and retrieval can be switched independently.
- [x] Missing live EUR-Lex endpoint or credential configuration causes a clear monitor/search operational error.
- [x] Missing live CELLAR endpoint or credential configuration causes a clear retrieval operational error.
- [x] The app never silently falls back to mock mode when live mode is selected.
- [x] Current local development defaults remain mock mode.
- [x] Errors are recorded through audit/alert visibility using safe IDs, counts, statuses, and failure codes only.
- [x] Tests cover default mock mode, live mode missing-config errors, and independent search/retrieval toggles.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/13-implement-real-eurlex-search-adapter.md
- .scratch/sanctions-delta-dashboard/issues/14-implement-real-cellar-source-content-adapter.md
