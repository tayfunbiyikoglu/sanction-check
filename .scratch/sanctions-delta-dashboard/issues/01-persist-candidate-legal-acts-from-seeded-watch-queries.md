Status: completed

# Persist Candidate Legal Acts From Seeded Watch Queries

## Parent

.scratch/sanctions-delta-dashboard/PRD.md

## What to build

Create the first real persistence-backed vertical slice for seeded configured base acts, watch queries, monitor runs, and candidate legal acts. The API and Evidence Workbench should read the same seeded candidate data through the application layer rather than hard-coded route/UI arrays, and the monitor overview should expose basic run/candidate counts.

## Acceptance criteria

- [ ] Seed data includes at least one configured base act, one watch query, and three candidate legal acts: delta-ready, needs extraction correction, and no delta.
- [ ] API endpoints expose candidate legal acts, candidate detail, configured base act/watch query context, and monitor overview counts from the seeded application data.
- [ ] Evidence Workbench renders the seeded candidate legal acts and overview counts from the API.
- [ ] Tests cover seeded candidate retrieval and monitor overview behavior.
- [ ] Typecheck, tests, and build pass.

## Blocked by

None - can start immediately
