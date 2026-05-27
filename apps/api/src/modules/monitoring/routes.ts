import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  candidateLegalActs,
  exportBatches,
  extractionResults,
  monitorRuns,
  recordAuditEvent,
  watchQueries
} from "../seed-data.js";
import { buildEvidenceWorkbenchOverview } from "../evidence-workbench/read-model.js";
import {
  EurLexSearchConfigurationError,
  LiveEurLexWebServiceSearchAdapter,
  RecordedEurLexSearchAdapter,
  recordedEurLexSearchFixtures
} from "./eurlex-search-adapter.js";
import { LiveRssFeedAdapter, RssFeedConfigurationError } from "./rss-feed-adapter.js";
import { FilesystemSearchResponseRepository } from "./search-response-repository.js";
import { executeMonitorRun, type DiscoveryTrigger } from "./service.js";

export async function registerMonitoringRoutes(server: FastifyInstance) {
  const searchResponseRepository = buildSearchResponseRepository();

  server.get("/overview", async () => {
    if (server.persistence.monitoring) {
      const persistedCandidates = await server.persistence.monitoring.listCandidates();
      const persistedMonitorRuns = await server.persistence.monitoring.listMonitorRuns();
      const persistedExportBatches = server.persistence.exports ? await server.persistence.exports.listExportBatches() : [];
      const persistedExtractionResults = (
        await Promise.all(
          persistedCandidates.map((candidate) => server.persistence.monitoring!.listExtractionResults(candidate.id))
        )
      ).flat();

      return buildEvidenceWorkbenchOverview({
        candidateLegalActs: persistedCandidates,
        exportBatches: persistedExportBatches,
        extractionResults: persistedExtractionResults,
        monitorRuns: persistedMonitorRuns
      });
    }

    return buildEvidenceWorkbenchOverview({
      candidateLegalActs,
      exportBatches,
      extractionResults,
      monitorRuns
    });
  });

  server.get("/runs", async () => ({
    monitorRuns: server.persistence.monitoring ? await server.persistence.monitoring.listMonitorRuns() : monitorRuns
  }));

  server.post("/runs", async (request, reply) => {
    const body = request.body as {
      watchQueryId?: string;
      triggers?: DiscoveryTrigger[];
      startedAt?: string;
      finishedAt?: string;
    };

    if (!body.watchQueryId || !Array.isArray(body.triggers)) {
      return reply.code(400).send({ message: "watchQueryId and triggers are required" });
    }

    try {
      const result = server.persistence.monitoring ? await server.persistence.monitoring.executeMonitorRun({
        watchQueryId: body.watchQueryId,
        triggers: body.triggers,
        ...(body.startedAt ? { startedAt: body.startedAt } : {}),
        ...(body.finishedAt ? { finishedAt: body.finishedAt } : {})
      }) : executeMonitorRun({
        watchQueryId: body.watchQueryId,
        triggers: body.triggers,
        ...(body.startedAt ? { startedAt: body.startedAt } : {}),
        ...(body.finishedAt ? { finishedAt: body.finishedAt } : {})
      });

      recordAuditEvent({
        type: "MONITOR_RUN_RECORDED",
        monitorRunId: result.monitorRun.id,
        occurredAt: result.monitorRun.finishedAt ?? result.monitorRun.startedAt,
        payload: {
          status: result.monitorRun.status,
          source: result.monitorRun.source,
          watchQueryId: result.monitorRun.watchQueryId,
          itemsSeen: result.monitorRun.itemsSeen,
          newCandidates: result.monitorRun.newCandidates,
          errorCount: result.errors.length
        }
      });

      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Monitor run failed"
      });
    }
  });

  server.post("/search-runs", async (request, reply) => {
    const body = (request.body ?? {}) as {
      watchQueryId?: string;
      startedAt?: string;
      finishedAt?: string;
      mode?: "mock" | "live";
    };

    if (!body.watchQueryId) {
      return reply.code(400).send({ message: "watchQueryId is required" });
    }

    const activeWatchQueries = server.persistence.mode === "postgres" ? await server.persistence.configuration.listWatchQueries() : watchQueries;
    const watchQuery = activeWatchQueries.find((query) => query.id === body.watchQueryId && query.isActive);

    if (!watchQuery) {
      return reply.code(404).send({ message: "Active watch query not found" });
    }

    const startedAt = body.startedAt ?? new Date().toISOString();
    const finishedAt = body.finishedAt ?? startedAt;
    const adapter = buildEurLexSearchAdapter(body.mode);

    try {
      const search = await adapter.search({
        watchQuery,
        monitorWindow: {
          startedAt,
          finishedAt
        }
      });
      const searchResponse = await searchResponseRepository.store({
        watchQueryId: watchQuery.id,
        response: search.rawResponse,
        retrievedAt: finishedAt
      });
      const result = server.persistence.monitoring ? await server.persistence.monitoring.executeMonitorRun({
        watchQueryId: watchQuery.id,
        triggers: search.triggers,
        startedAt,
        finishedAt,
        searchResponse,
        discoveryErrors: search.errors,
        itemsSeen: search.triggers.length + search.errors.length
      }) : executeMonitorRun({
        watchQueryId: watchQuery.id,
        triggers: search.triggers,
        startedAt,
        finishedAt,
        searchResponse,
        discoveryErrors: search.errors,
        itemsSeen: search.triggers.length + search.errors.length
      });

      recordAuditEvent({
        type: "MONITOR_RUN_RECORDED",
        monitorRunId: result.monitorRun.id,
        occurredAt: result.monitorRun.finishedAt ?? result.monitorRun.startedAt,
        payload: {
          status: result.monitorRun.status,
          source: result.monitorRun.source,
          watchQueryId: result.monitorRun.watchQueryId,
          itemsSeen: result.monitorRun.itemsSeen,
          newCandidates: result.monitorRun.newCandidates,
          errorCount: result.errors.length,
          searchResponseReference: searchResponse.reference,
          searchResponseHash: searchResponse.contentHash
        }
      });

      return reply.code(201).send({
        ...result,
        searchResponse
      });
    } catch (error) {
      if (error instanceof EurLexSearchConfigurationError) {
        return reply.code(409).send({ message: error.message });
      }

      throw error;
    }
  });

  server.post("/rss-runs", async (request, reply) => {
    const body = (request.body ?? {}) as {
      watchQueryId?: string;
      feedUrl?: string;
      publicationYear?: number;
      startedAt?: string;
      finishedAt?: string;
    };

    if (!body.watchQueryId) {
      return reply.code(400).send({ message: "watchQueryId is required" });
    }

    const activeWatchQueries = server.persistence.mode === "postgres" ? await server.persistence.configuration.listWatchQueries() : watchQueries;
    const watchQuery = activeWatchQueries.find((query) => query.id === body.watchQueryId && query.isActive);

    if (!watchQuery) {
      return reply.code(404).send({ message: "Active watch query not found" });
    }

    const startedAt = body.startedAt ?? new Date().toISOString();
    const finishedAt = body.finishedAt ?? startedAt;
    const adapter = new LiveRssFeedAdapter({
      feedUrl: body.feedUrl ?? watchQuery.feedUrl ?? process.env.EURLEX_RSS_FEED_URL
    });

    try {
      const feed = await adapter.fetch({
        watchQuery,
        monitorWindow: {
          startedAt,
          finishedAt
        }
      });
      const publicationYear = body.publicationYear ?? parsePublicationYear(process.env.EURLEX_RSS_PUBLICATION_YEAR) ?? 2026;
      const triggers = filterTriggersByPublicationYear(feed.triggers, publicationYear);
      const result = server.persistence.monitoring ? await server.persistence.monitoring.executeMonitorRun({
        watchQueryId: watchQuery.id,
        triggers,
        startedAt,
        finishedAt,
        discoveryErrors: feed.errors,
        itemsSeen: feed.triggers.length + feed.errors.length
      }) : executeMonitorRun({
        watchQueryId: watchQuery.id,
        triggers,
        startedAt,
        finishedAt,
        discoveryErrors: feed.errors,
        itemsSeen: feed.triggers.length + feed.errors.length
      });

      recordAuditEvent({
        type: "MONITOR_RUN_RECORDED",
        monitorRunId: result.monitorRun.id,
        occurredAt: result.monitorRun.finishedAt ?? result.monitorRun.startedAt,
        payload: {
          status: result.monitorRun.status,
          source: "RSS",
          watchQueryId: result.monitorRun.watchQueryId,
          itemsSeen: result.monitorRun.itemsSeen,
          newCandidates: result.monitorRun.newCandidates,
          errorCount: result.errors.length,
          feedUrl: feed.feedUrl,
          publicationYear,
          filteredOut: feed.triggers.length - triggers.length
        }
      });

      return reply.code(201).send({
        ...result,
        feed: {
          url: feed.feedUrl,
          contentLength: Buffer.byteLength(feed.body, "utf8"),
          publicationYear,
          filteredOut: feed.triggers.length - triggers.length
        }
      });
    } catch (error) {
      if (error instanceof RssFeedConfigurationError) {
        return reply.code(409).send({ message: error.message });
      }

      throw error;
    }
  });
}

function filterTriggersByPublicationYear(triggers: DiscoveryTrigger[], publicationYear: number): DiscoveryTrigger[] {
  return triggers.filter((trigger) => getTriggerPublicationYear(trigger) === publicationYear);
}

function getTriggerPublicationYear(trigger: DiscoveryTrigger): number | undefined {
  const dateYear = trigger.publicationDate?.match(/^(\d{4})-/)?.[1];

  if (dateYear) {
    return Number(dateYear);
  }

  const celexYear = trigger.celexId?.match(/^\d(\d{4})/)?.[1];

  return celexYear ? Number(celexYear) : undefined;
}

function parsePublicationYear(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : undefined;
}

function buildEurLexSearchAdapter(mode: "mock" | "live" | undefined) {
  const configuredMode = mode ?? parseIntegrationMode(process.env.EURLEX_SEARCH_MODE);

  if (configuredMode === "live") {
    return new LiveEurLexWebServiceSearchAdapter({
      endpointUrl: process.env.EURLEX_WEBSERVICE_URL,
      username: process.env.EURLEX_WEBSERVICE_USERNAME,
      password: process.env.EURLEX_WEBSERVICE_PASSWORD
    });
  }

  return new RecordedEurLexSearchAdapter(recordedEurLexSearchFixtures);
}

function parseIntegrationMode(value: string | undefined): "mock" | "live" {
  return value === "live" ? "live" : "mock";
}

function buildSearchResponseRepository() {
  return new FilesystemSearchResponseRepository(
    process.env.SEARCH_RESPONSE_STORAGE_DIR ?? path.resolve(process.cwd(), "../../storage/search-responses")
  );
}
