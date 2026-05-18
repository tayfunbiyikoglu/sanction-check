import { watchQueries } from "../modules/seed-data.js";
import { buildSafeRssSmokeReport, requireLiveSmokeOptIn } from "../modules/integration-smoke/smoke-report.js";
import { LiveRssFeedAdapter } from "../modules/monitoring/rss-feed-adapter.js";

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

try {
  const now = new Date().toISOString();
  const adapter = new LiveRssFeedAdapter({
    feedUrl: process.env.EURLEX_RSS_FEED_URL
  });
  const result = await adapter.fetch({
    watchQuery,
    monitorWindow: {
      startedAt: now,
      finishedAt: now
    }
  });

  console.log(
    JSON.stringify(
      buildSafeRssSmokeReport({
        watchQuery,
        feedUrl: result.feedUrl,
        triggers: result.triggers,
        errors: result.errors
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
        error: error instanceof Error ? error.message : "Live EUR-Lex RSS smoke test failed"
      },
      null,
      2
    )
  );
  process.exit(1);
}
