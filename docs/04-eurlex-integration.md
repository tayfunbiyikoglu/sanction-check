# EUR-Lex Integration Notes

## Constraint
Do not crawl EUR-Lex. Use supported integration mechanisms.

## Integration Channels

### 1. RSS Feeds
Use configured EUR-Lex RSS feeds as fast trigger sources. RSS should be treated as candidate notification only. A saved-search RSS feed returns a current result window, not only the one newest alert, so every run must deduplicate by Legal Act Identity.

Initial compliance queries include variations around Regulation 32014R0269, but the monitor should support multiple configured base acts over time. Example initial queries:

```text
MS=32014R0269 ORDER BY XC DESC
MS=32014R0269 OR EA=32014R0269 ORDER BY XC DESC
MS=32014R0269 OR EA=32014R0269 OR BF=32014R0269 OR RD=32014R0269 OR LB=32014R0269 ORDER BY XC DESC
```

### 2. EUR-Lex Web Service
Use EUR-Lex Web Service for official search and metadata lookup. It supports expert search style queries and returns structured XML. Separate Web Service registration is required; a normal EUR-Lex website account can fail WS-Security UsernameToken authentication.

Usage pattern:

1. Run search query.
2. Read CELEX/CELLAR metadata from result.
3. Store search response for audit.
4. Pass identifiers to content retrieval layer.

### 3. CELLAR REST API
Use CELLAR for official document metadata/content retrieval after obtaining identifiers from EUR-Lex search results.

Usage pattern:

1. Resolve CELLAR URI/identifier from the Candidate Legal Act's best available Legal Act Identity: CELEX ID, then CELLAR ID, then official document URI.
2. Retrieve metadata and available manifestations.
3. Prefer structured XML/Formex content when available.
4. Store raw retrieved document content or immutable reference.

For MVP, CELLAR retrieval discovers available language manifestations first, then stores only English Source Content when English is present. If English is absent, the Candidate Legal Act becomes a Language Pending Candidate with available languages recorded for operational visibility. When multiple English manifestations are available, prefer XML/Formex, then XHTML/HTML, then plain text. PDF is not used as MVP Source Content for extraction.

The public retrieval endpoint currently used for live CELLAR smoke testing is:

```text
https://publications.europa.eu/resource/
```

For a CELEX identity, the adapter resolves an official resource URL, requests English content, stores the retrieved bytes by immutable hash/reference, and keeps the content type. EUR-Lex XHTML is valid Source Content for the MVP parser.

### 4. SPARQL Endpoint
Use only if metadata relationship queries are needed, for example act relationships, amendments, or linked works.

## Polling Strategy

- Run hourly.
- Store last successful run timestamp.
- Query with overlap window to avoid missed documents.
- Deduplicate by CELEX ID/CELLAR ID/document URI.
- Never rely only on latest RSS timestamp.

## Configuration Management

Watch queries and configured base acts are seeded or changed through admin scripts for MVP, not edited through the dashboard UI. Changes should be audited.

For live EUR-Lex search, the stored Watch Query text is authoritative and is passed to the EUR-Lex Web Service. Configured Base Acts describe what the query watches, but the MVP does not regenerate search queries from Configured Base Acts.

Live search results become Discovery Triggers only when they include at least one Legal Act Identity field: CELEX ID, CELLAR ID, or official document URI. Title-only search results are treated as malformed trigger errors and do not create Candidate Legal Acts.

Live integration configuration keeps search and retrieval separate:

- `EURLEX_SEARCH_MODE=mock|live` controls whether monitor runs use recorded/mock EUR-Lex search responses or the live EUR-Lex Web Service.
- `CELLAR_RETRIEVAL_MODE=mock|live` controls whether Source Content retrieval uses recorded/mock CELLAR content or live CELLAR retrieval.

This allows live search to be tested with mock Source Content retrieval, and known CELEX/CELLAR retrieval to be tested without running live search.

If live mode is selected but required endpoint or credential configuration is missing, the affected operation fails with a clear operational error and audit/alert visibility. The application should not silently fall back to mock mode.

## RSS Feed Integration

EUR-Lex supports predefined RSS alerts and user-created RSS alerts from saved searches. RSS is used only as a Discovery Trigger source; it does not provide Source Content and does not produce Sanctions Delta Records.

Configure a feed URL with:

```bash
EURLEX_RSS_FEED_URL=https://eur-lex.europa.eu/your-feed.rss
```

The API can run a feed through:

```http
POST /monitoring/rss-runs
```

with `watchQueryId` and optionally `feedUrl` in the JSON body. The run parses RSS/Atom items, extracts CELEX/CELLAR/official URI identities from links, GUIDs, titles, or descriptions, and then uses the normal Legal Act Identity deduplication path.

The current saved RSS feed used during live testing is:

```text
https://eur-lex.europa.eu/EN/display-feed.rss?myRssId=zqe49YNw6BwwdPmm33RRPDk44bB%2F2Iyyhz81JRn0trw%3D
```

Live testing proved that the feed can return many current items in one response. One real positive case is CELEX `32026R1055`, Council Implementing Regulation (EU) 2026/1055 of 11 May 2026, which contains an Annex adding 16 persons and 7 entities.

## Dashboard Live Flow

The local Evidence Workbench can exercise the live path manually:

1. Run the RSS feed from the dashboard.
2. Open the candidate for CELEX `32026R1055` or another discovered candidate.
3. Retrieve live Source Content from CELLAR.
4. Classify/extract the Source Content.
5. Review the extracted Sanctions Delta Records and export when the extraction is complete.

This flow is currently backed by in-memory API state. If the API restarts, rerun RSS, retrieval, and classification to repopulate the dashboard until PostgreSQL persistence is wired.

## Live Smoke Tests

Normal `typecheck`, `test`, and `build` runs use recorded fixtures only. They must not call live EUR-Lex or CELLAR.

Live smoke tests are manual, independently runnable, and require explicit opt-in:

```bash
RUN_LIVE_EURLEX_SMOKE=1 \
EURLEX_SEARCH_MODE=live \
EURLEX_WEBSERVICE_URL=https://eur-lex.europa.eu/EURLexWebService \
EURLEX_WEBSERVICE_USERNAME=your-registered-eurlex-username \
EURLEX_WEBSERVICE_PASSWORD=your-eurlex-webservice-password \
npm run smoke:eurlex-search
```

The search smoke command runs a configured Watch Query, defaulting to `watch-query-269-rss`. Override it with `EURLEX_SMOKE_WATCH_QUERY_ID`. A successful result reports safe Discovery Trigger counts, malformed trigger counts, Legal Act Identity values, and the immutable Search Response Reference metadata. It does not print extracted names, dates of birth, listed-entry identifiers, addresses, Source Content bytes, or Evidence Text.

```bash
RUN_LIVE_EURLEX_SMOKE=1 \
EURLEX_RSS_FEED_URL=https://eur-lex.europa.eu/your-feed.rss \
npm run smoke:rss-feed
```

The RSS smoke command fetches one configured feed and reports only safe counts and Legal Act Identity values. It does not print RSS item descriptions or source content.

```bash
RUN_LIVE_EURLEX_SMOKE=1 \
CELLAR_RETRIEVAL_MODE=live \
CELLAR_ENDPOINT_URL=https://publications.europa.eu/resource/ \
CELLAR_SMOKE_CELEX_ID=32014R0269 \
npm run smoke:cellar-retrieval
```

The CELLAR smoke command retrieves known English Source Content for a CELEX/CELLAR identity and reports only the Legal Act Identity, retrieval status, language count, Source Content reference, hash, length, content type, language, source URI, and retrieval timestamp. It stores the retrieved bytes in the immutable local Source Content repository but does not print them.

For a positive Annex extraction smoke case, use:

```bash
RUN_LIVE_EURLEX_SMOKE=1 \
CELLAR_RETRIEVAL_MODE=live \
CELLAR_ENDPOINT_URL=https://publications.europa.eu/resource/ \
CELLAR_SMOKE_CELEX_ID=32026R1055 \
npm run smoke:cellar-retrieval
```

## Error Handling

- Retrieval failed: retry with backoff and surface after repeated failures.
- Parse failed: keep candidate visible for extraction correction or reprocessing.
- Language pending: retry until English content appears or an operational threshold is exceeded.
- Duplicate: link to existing candidate.
- API limit exceeded: record operational incident and retry next run.
