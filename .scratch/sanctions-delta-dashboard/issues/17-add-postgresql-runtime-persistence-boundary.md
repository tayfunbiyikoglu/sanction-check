Status: completed

# Add PostgreSQL Runtime Persistence Boundary

## Parent

.scratch/postgresql-persistence/PRD.md

## What to build

Introduce PostgreSQL as the default local runtime persistence mode for the API while preserving the current dashboard and API behavior. This slice should create the durable persistence boundary that later monitoring, Candidate Legal Act, retrieval, extraction, correction, and export slices can use.

The API should no longer treat in-memory storage as the normal runtime path. It should connect to PostgreSQL by default, expose clear startup/configuration failures when the database, schema, or required baseline configuration is missing, and keep in-memory repositories available only for focused unit tests or explicit fallback.

Migrations and baseline seed data must be explicit commands. Normal API startup must not silently migrate, reseed, or overwrite operational records. Repository interfaces should be module-owned and composed into app dependencies rather than exposed as one large shared application store.

## Acceptance criteria

- [ ] `DATABASE_URL` configures the local runtime PostgreSQL connection.
- [ ] `TEST_DATABASE_URL` configures a dedicated PostgreSQL integration test database.
- [ ] The API uses PostgreSQL as the default local runtime persistence mode.
- [ ] In-memory repositories remain available only for focused unit tests or explicit fallback.
- [ ] Explicit migration command can create the initial schema on a clean database.
- [ ] Explicit seed command can insert baseline Configured Base Acts and Watch Queries without overwriting operational state.
- [ ] Normal API startup does not run hidden migrations.
- [ ] Normal API startup does not silently seed, reseed, or overwrite operational records.
- [ ] API startup fails clearly when PostgreSQL is unreachable, schema is missing, or required baseline configuration is missing.
- [ ] Repository interfaces are module-owned and composed into app dependencies, not implemented as one giant application store.
- [ ] Integration tests use `TEST_DATABASE_URL` and never touch the local development database.
- [ ] Integration test setup can reset the dedicated test database with migrations/truncation.
- [ ] Existing dashboard/API behavior remains the same from a user's perspective.
- [ ] Full typecheck, tests, and build pass.

## Blocked by

None - can start immediately
