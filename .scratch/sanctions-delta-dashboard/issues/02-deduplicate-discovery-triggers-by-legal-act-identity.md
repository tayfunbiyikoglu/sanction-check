Status: completed

# Deduplicate Discovery Triggers by Legal Act Identity

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Add monitor service behavior that accepts repeated discovery triggers, resolves legal act identity, merges duplicates into one candidate legal act, and records monitor-run outcomes with query snapshots.

## Acceptance criteria

- [ ] Discovery triggers are treated as non-authoritative and cannot create sanctions delta records.
- [ ] Candidate legal acts deduplicate by CELEX ID, then CELLAR ID, then official document URI.
- [ ] Overlapping monitor windows can rediscover existing candidate legal acts without duplicating them.
- [ ] Monitor run results record items seen, new candidates, query snapshot, and status.
- [ ] Tests cover CELEX, CELLAR, URI fallback, and repeated trigger merging.

## Blocked by

- .scratch/sanctions-delta-dashboard/issues/01-persist-candidate-legal-acts-from-seeded-watch-queries.md
