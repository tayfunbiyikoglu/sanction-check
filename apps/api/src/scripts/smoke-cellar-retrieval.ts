import path from "node:path";
import type { CandidateLegalAct } from "@sanctions/domain";
import { LiveCellarSourceContentAdapter } from "../modules/retrieval/cellar-source-adapter.js";
import { FilesystemSourceContentRepository } from "../modules/retrieval/source-content-repository.js";
import { SourceRetrievalService } from "../modules/retrieval/source-retrieval-service.js";
import type { RetrievalClock } from "../modules/retrieval/types.js";
import { buildSafeCellarSmokeReport, requireLiveSmokeOptIn } from "../modules/integration-smoke/smoke-report.js";

const skipped = requireLiveSmokeOptIn(process.env);

if (skipped) {
  console.log(JSON.stringify(skipped, null, 2));
  process.exit(0);
}

if (process.env.CELLAR_RETRIEVAL_MODE !== "live") {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "Set CELLAR_RETRIEVAL_MODE=live before running the live CELLAR retrieval smoke test."
      },
      null,
      2
    )
  );
  process.exit(1);
}

const now = new Date();
const clock: RetrievalClock = {
  now: () => now
};
const celexId = process.env.CELLAR_SMOKE_CELEX_ID ?? "32014R0269";
const candidate: CandidateLegalAct = {
  id: `candidate-smoke-${celexId}`,
  celexId,
  ...(process.env.CELLAR_SMOKE_CELLAR_ID ? { cellarId: process.env.CELLAR_SMOKE_CELLAR_ID } : {}),
  ...(process.env.CELLAR_SMOKE_OFFICIAL_URI ? { officialUri: process.env.CELLAR_SMOKE_OFFICIAL_URI } : {}),
  title: "Live CELLAR smoke candidate",
  status: "DETECTED",
  workingLanguage: "en",
  detectedAt: now.toISOString(),
  lastSeenAt: now.toISOString(),
  retrieval: {
    status: "NOT_REQUESTED",
    attempts: 0
  }
};

try {
  const adapter = new LiveCellarSourceContentAdapter({
    endpointUrl: process.env.CELLAR_ENDPOINT_URL,
    apiKey: process.env.CELLAR_API_KEY
  });
  const repository = new FilesystemSourceContentRepository(
    process.env.SOURCE_CONTENT_STORAGE_DIR ?? path.resolve(process.cwd(), "../../storage/live-smoke/source-content")
  );
  const service = new SourceRetrievalService(adapter, repository, clock);
  const retrieved = await service.retrieveEnglishSourceContent(candidate);

  console.log(
    JSON.stringify(
      buildSafeCellarSmokeReport({
        candidate: retrieved,
        availableLanguageCount: retrieved.retrieval?.availableLanguages?.length ?? 0,
        ...(retrieved.sourceContent ? { sourceContent: retrieved.sourceContent } : {})
      }),
      null,
      2
    )
  );

  if (!retrieved.sourceContent) {
    process.exit(1);
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Live CELLAR retrieval smoke test failed"
      },
      null,
      2
    )
  );
  process.exit(1);
}
