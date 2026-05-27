import type { CandidateLegalAct, WatchQuery } from "@sanctions/domain";
import type { FastifyInstance } from "fastify";

const defaultHourlyIntervalMs = 60 * 60 * 1000;

export interface AutomatedRssWorkflowOptions {
  publicationYear?: number;
  retrievalMode?: "mock" | "live";
}

export interface AutomatedCandidateProcessingResult {
  candidateId: string;
  retrievalStatus?: NonNullable<CandidateLegalAct["retrieval"]>["status"];
  extractionStatus: "SKIPPED" | "COMPLETED" | "FAILED";
  errorMessage?: string;
}

export interface AutomatedRssWorkflowResult {
  watchQueryCount: number;
  itemsSeen: number;
  newCandidates: number;
  processedCandidates: AutomatedCandidateProcessingResult[];
  errors: string[];
}

export async function runAutomatedRssWorkflow(
  server: FastifyInstance,
  options: AutomatedRssWorkflowOptions = {}
): Promise<AutomatedRssWorkflowResult> {
  const watchQueries = await listActiveRssWatchQueries(server);
  const knownCandidateIds = new Set((await listCandidates(server)).map((candidate) => candidate.id));
  const processedCandidateIds = new Set<string>();
  const processedCandidates: AutomatedCandidateProcessingResult[] = [];
  const errors: string[] = [];
  let itemsSeen = 0;
  let newCandidates = 0;

  for (const watchQuery of watchQueries) {
    const rssResult = await runRssWatchQuery(server, watchQuery, options);
    itemsSeen += rssResult.monitorRun.itemsSeen;
    newCandidates += rssResult.monitorRun.newCandidates;
    errors.push(...rssResult.errors);

    for (const candidate of rssResult.candidates) {
      if (knownCandidateIds.has(candidate.id) || processedCandidateIds.has(candidate.id)) {
        continue;
      }

      processedCandidateIds.add(candidate.id);
      knownCandidateIds.add(candidate.id);
      processedCandidates.push(await retrieveAndExtractCandidate(server, candidate.id, options));
    }
  }

  return {
    watchQueryCount: watchQueries.length,
    itemsSeen,
    newCandidates,
    processedCandidates,
    errors
  };
}

export function startHourlyRssAutomation(server: FastifyInstance, options: AutomatedRssWorkflowOptions = {}) {
  const intervalMs = resolveAutomationIntervalMs();
  let runInProgress = false;

  async function runOnce() {
    if (runInProgress) {
      server.log.warn("Skipping scheduled RSS automation run because the previous run is still in progress");
      return;
    }

    runInProgress = true;

    try {
      const result = await runAutomatedRssWorkflow(server, options);
      server.log.info(
        {
          watchQueryCount: result.watchQueryCount,
          itemsSeen: result.itemsSeen,
          newCandidates: result.newCandidates,
          processedCandidates: result.processedCandidates.length,
          errorCount: result.errors.length
        },
        "Scheduled RSS automation run completed"
      );
    } catch (cause) {
      server.log.error(
        {
          error: cause instanceof Error ? cause.message : String(cause)
        },
        "Scheduled RSS automation run failed"
      );
    } finally {
      runInProgress = false;
    }
  }

  const timer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  timer.unref();

  if (process.env.RSS_AUTOMATION_RUN_ON_STARTUP === "true") {
    server.addHook("onReady", () => {
      void runOnce();
    });
  }

  server.addHook("onClose", () => {
    clearInterval(timer);
  });

  server.log.info({ intervalMs }, "Scheduled RSS automation worker started");

  return {
    stop: () => clearInterval(timer),
    runOnce
  };
}

async function listActiveRssWatchQueries(server: FastifyInstance): Promise<WatchQuery[]> {
  const watchQueries = await server.persistence.configuration.listWatchQueries();
  return watchQueries.filter((query) => query.source === "RSS" && query.isActive);
}

async function listCandidates(server: FastifyInstance): Promise<CandidateLegalAct[]> {
  if (server.persistence.monitoring) {
    return server.persistence.monitoring.listCandidates();
  }

  const response = await server.inject({ method: "GET", url: "/candidates" });
  const body = response.json() as { candidates: CandidateLegalAct[] };
  return body.candidates;
}

async function runRssWatchQuery(
  server: FastifyInstance,
  watchQuery: WatchQuery,
  options: AutomatedRssWorkflowOptions
) {
  const response = await server.inject({
    method: "POST",
    url: "/monitoring/rss-runs",
    payload: {
      watchQueryId: watchQuery.id,
      ...(watchQuery.feedUrl ? { feedUrl: watchQuery.feedUrl } : {}),
      ...(options.publicationYear ? { publicationYear: options.publicationYear } : {})
    }
  });

  if (response.statusCode >= 400) {
    throw new Error(readErrorMessage(response, `RSS run failed for ${watchQuery.id}`));
  }

  return response.json() as {
    monitorRun: {
      itemsSeen: number;
      newCandidates: number;
    };
    candidates: CandidateLegalAct[];
    errors: string[];
  };
}

async function retrieveAndExtractCandidate(
  server: FastifyInstance,
  candidateId: string,
  options: AutomatedRssWorkflowOptions
): Promise<AutomatedCandidateProcessingResult> {
  const retrievalResponse = await server.inject({
    method: "POST",
    url: `/retrieval/candidates/${encodeURIComponent(candidateId)}/retrieve-source-content`,
    payload: {
      mode: options.retrievalMode ?? resolveRetrievalMode(),
      endpointUrl: process.env.CELLAR_ENDPOINT_URL ?? "https://publications.europa.eu/resource/",
      ...(process.env.CELLAR_API_KEY ? { apiKey: process.env.CELLAR_API_KEY } : {})
    }
  });

  if (retrievalResponse.statusCode >= 400) {
    return {
      candidateId,
      extractionStatus: "FAILED",
      errorMessage: readErrorMessage(retrievalResponse, "Source Content retrieval failed")
    };
  }

  const retrievalBody = retrievalResponse.json() as {
    candidate: CandidateLegalAct;
  };

  if (!retrievalBody.candidate.sourceContent) {
    return {
      candidateId,
      ...candidateRetrievalStatus(retrievalBody.candidate),
      extractionStatus: "SKIPPED"
    };
  }

  const classificationResponse = await server.inject({
    method: "POST",
    url: `/classification/candidates/${encodeURIComponent(candidateId)}/classify-source-content`
  });

  if (classificationResponse.statusCode >= 400) {
    return {
      candidateId,
      ...candidateRetrievalStatus(retrievalBody.candidate),
      extractionStatus: "FAILED",
      errorMessage: readErrorMessage(classificationResponse, "Source Content extraction failed")
    };
  }

  return {
    candidateId,
    ...candidateRetrievalStatus(retrievalBody.candidate),
    extractionStatus: "COMPLETED"
  };
}

function candidateRetrievalStatus(candidate: CandidateLegalAct) {
  return candidate.retrieval?.status ? { retrievalStatus: candidate.retrieval.status } : {};
}

function readErrorMessage(response: { json(): unknown }, fallback: string): string {
  try {
    const body = response.json() as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

function resolveRetrievalMode(): "mock" | "live" {
  return process.env.CELLAR_RETRIEVAL_MODE === "mock" ? "mock" : "live";
}

function resolveAutomationIntervalMs(): number {
  const configured = Number(process.env.RSS_AUTOMATION_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultHourlyIntervalMs;
}
