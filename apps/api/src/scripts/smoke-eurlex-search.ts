import path from "node:path";
import { LiveEurLexWebServiceSearchAdapter } from "../modules/monitoring/eurlex-search-adapter.js";
import { FilesystemSearchResponseRepository } from "../modules/monitoring/search-response-repository.js";
import { watchQueries } from "../modules/seed-data.js";
import { buildSafeSearchSmokeReport, requireLiveSmokeOptIn } from "../modules/integration-smoke/smoke-report.js";

const skipped = requireLiveSmokeOptIn(process.env);

if (skipped) {
  console.log(JSON.stringify(skipped, null, 2));
  process.exit(0);
}

const watchQueryId = process.env.EURLEX_SMOKE_WATCH_QUERY_ID ?? "watch-query-269-rss";
const watchQuery = watchQueries.find((query) => query.id === watchQueryId);

if (!watchQuery) {
  console.error(JSON.stringify({ ok: false, error: `Watch Query not found: ${watchQueryId}` }, null, 2));
  process.exit(1);
}

if (process.env.EURLEX_SEARCH_MODE !== "live") {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "Set EURLEX_SEARCH_MODE=live before running the live EUR-Lex search smoke test."
      },
      null,
      2
    )
  );
  process.exit(1);
}

try {
  const retrievedAt = new Date().toISOString();
  const adapter = new LiveEurLexWebServiceSearchAdapter({
    endpointUrl: process.env.EURLEX_WEBSERVICE_URL,
    username: process.env.EURLEX_WEBSERVICE_USERNAME,
    password: process.env.EURLEX_WEBSERVICE_PASSWORD
  });
  const search = await adapter.search({
    watchQuery,
    monitorWindow: {
      startedAt: retrievedAt,
      finishedAt: retrievedAt
    }
  });
  const repository = new FilesystemSearchResponseRepository(
    process.env.SEARCH_RESPONSE_STORAGE_DIR ??
      path.resolve(process.cwd(), "../../storage/live-smoke/search-responses")
  );
  const searchResponse = await repository.store({
    watchQueryId: watchQuery.id,
    response: search.rawResponse,
    retrievedAt
  });

  console.log(
    JSON.stringify(
      buildSafeSearchSmokeReport({
        watchQuery,
        triggers: search.triggers,
        errors: search.errors,
        searchResponse
      }),
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Live EUR-Lex search smoke test failed"
      },
      null,
      2
    )
  );
  process.exit(1);
}
