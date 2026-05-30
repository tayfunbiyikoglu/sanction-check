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

## Local Development Setup

### Prerequisites

- Node.js 22 or newer
- npm
- Docker with Docker Compose

### First-Time Setup From a Fresh Clone

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create local environment configuration:

   ```bash
   cp .env.example .env
   ```

   The default `.env.example` points the API at the local PostgreSQL service from `docker-compose.yml`.

3. Start PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

4. Create or update database tables:

   ```bash
   npm run db:migrate --workspace @sanctions/api
   ```

5. Seed baseline configuration:

   ```bash
   npm run db:seed --workspace @sanctions/api
   ```

6. Start the API:

   ```bash
   npm run dev:api
   ```

   The API listens on `http://localhost:4000`.

7. In a second terminal, start the web app:

   ```bash
   npm run dev:web
   ```

   The web app listens on `http://localhost:5173` and proxies `/api/*` requests to the API.

### Useful Checks

```bash
npm run typecheck
npm test
```

For a quick API smoke check after startup, open `http://localhost:4000/health`.

### Data And Storage Notes

Database schema is recreated from SQL migrations in `apps/api/db/migrations/`. Baseline Configured Base Acts and Watch Queries are seeded from `apps/api/src/modules/seed-data.ts`.

Operational data such as monitor runs, discovered candidates, extraction results, exports, and downloaded Source Content is not part of the repository. A fresh clone starts with an empty operational database after migration and seed. Source Content is stored through a configurable repository adapter. Local development uses filesystem storage under `storage/source-content/` by default, while deployments can set `SOURCE_CONTENT_STORAGE_MODE=azure` with `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER_NAME` to store the same immutable references as Azure Blob objects. The configured Azure container should already exist.

Never commit `.env`; it is ignored by Git and may contain local credentials.

### AI-Assisted Extraction Provider

The `AI Extract` action is configured on the API through environment variables. The UI does not expose provider selection.

For OpenAI:

```bash
AI_EXTRACTION_PROVIDER=openai
AI_EXTRACTION_MODEL=gpt-5-mini
OPENAI_API_KEY=...
```

For Azure OpenAI:

```bash
AI_EXTRACTION_PROVIDER=azure-openai
AI_EXTRACTION_MODEL=your-deployment-name
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_API_VERSION=
```

`AI_EXTRACTION_MODEL` is the OpenAI model name for OpenAI and the deployment name for Azure OpenAI. The older `OPENAI_EXTRACTION_MODEL`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_MODEL` variables are still accepted as compatibility aliases, but new environments should use `AI_EXTRACTION_MODEL`.

The current Azure OpenAI v1 Responses API path is `/openai/v1/responses`; `AZURE_OPENAI_API_VERSION` is optional. Leave it blank for the v1 API unless your Azure resource specifically asks for a v1 Responses API version such as `preview`. Older inference preview versions such as `2024-02-15-preview` are not sent to the v1 Responses API. `AZURE_OPENAI_KEY` is also accepted as an alias for `AZURE_OPENAI_API_KEY`.

## Current Prototype Status

The local prototype can run the saved EUR-Lex RSS feed, retrieve official English Source Content from public CELLAR, classify/extract EUR-Lex XHTML Annex tables, and export complete Candidate Legal Acts. A proven live case is CELEX `32026R1055`, which extracts 23 Sanctions Delta Records from the Annex.

PostgreSQL persistence is wired for local runtime. Focused tests still use in-memory repositories unless they explicitly exercise PostgreSQL behavior.
