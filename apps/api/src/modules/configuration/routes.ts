import type { FastifyInstance } from "fastify";
import type { WatchQuery } from "@sanctions/domain";
import { configuredBaseActs, recordAuditEvent, watchQueries } from "../seed-data.js";

export async function registerConfigurationRoutes(server: FastifyInstance) {
  server.get("/", async () => ({
    configuredBaseActs: server.persistence.mode === "postgres" ? await server.persistence.configuration.listConfiguredBaseActs() : configuredBaseActs,
    watchQueries: server.persistence.mode === "postgres" ? await server.persistence.configuration.listWatchQueries() : watchQueries
  }));

  server.post("/watch-queries", async (request, reply) => {
    const body = (request.body ?? {}) as {
      actor?: string;
      name?: string;
      queryText?: string;
      feedUrl?: string;
      isActive?: boolean;
      configuredBaseActIds?: string[];
    };
    const feedUrl = body.feedUrl?.trim();

    if (!feedUrl) {
      return reply.code(400).send({ message: "feedUrl is required" });
    }

    const configuredBaseActIds =
      Array.isArray(body.configuredBaseActIds) && body.configuredBaseActIds.length > 0
        ? body.configuredBaseActIds
        : [configuredBaseActs[0]!.id];
    const watchQuery: WatchQuery = {
      id: buildWatchQueryId(feedUrl),
      name: body.name?.trim() || "EUR-Lex RSS query",
      source: "RSS",
      queryText: body.queryText?.trim() || feedUrl,
      feedUrl,
      isActive: body.isActive ?? true,
      createdAt: new Date().toISOString(),
      configuredBaseActIds
    };

    const savedWatchQuery = await server.persistence.configuration.saveWatchQuery(watchQuery);

    recordAuditEvent({
      type: "CONFIGURATION_CHANGED",
      actor: body.actor ?? "local-prototype-user",
      payload: {
        configurationType: "Watch Query",
        watchQueryId: savedWatchQuery.id,
        source: savedWatchQuery.source,
        changedFields: ["created"]
      }
    });

    return reply.code(201).send({ watchQuery: savedWatchQuery });
  });

  server.patch("/configured-base-acts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { actor?: string; isActive?: boolean; label?: string };
    const configuredBaseAct = configuredBaseActs.find((item) => item.id === id);

    if (!configuredBaseAct) {
      return reply.code(404).send({ message: "Configured Base Act not found" });
    }

    const changedFields: string[] = [];

    if (typeof body.isActive === "boolean" && configuredBaseAct.isActive !== body.isActive) {
      configuredBaseAct.isActive = body.isActive;
      changedFields.push("isActive");
    }

    if (typeof body.label === "string" && configuredBaseAct.label !== body.label) {
      configuredBaseAct.label = body.label;
      changedFields.push("label");
    }

    recordAuditEvent({
      type: "CONFIGURATION_CHANGED",
      actor: body.actor ?? "local-prototype-user",
      payload: {
        configurationType: "Configured Base Act",
        configuredBaseActId: configuredBaseAct.id,
        celexId: configuredBaseAct.celexId,
        changedFields
      }
    });

    return { configuredBaseAct };
  });

  server.patch("/watch-queries/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      actor?: string;
      isActive?: boolean;
      queryText?: string;
      name?: string;
      feedUrl?: string;
    };
    const configurationWatchQueries =
      server.persistence.mode === "postgres" ? await server.persistence.configuration.listWatchQueries() : watchQueries;
    const watchQuery = configurationWatchQueries.find((item) => item.id === id);

    if (!watchQuery) {
      return reply.code(404).send({ message: "Watch Query not found" });
    }

    const changedFields: string[] = [];
    const updatedWatchQuery: WatchQuery = { ...watchQuery };

    if (typeof body.isActive === "boolean" && updatedWatchQuery.isActive !== body.isActive) {
      updatedWatchQuery.isActive = body.isActive;
      changedFields.push("isActive");
    }

    if (typeof body.queryText === "string" && updatedWatchQuery.queryText !== body.queryText) {
      updatedWatchQuery.queryText = body.queryText;
      changedFields.push("queryText");
    }

    if (typeof body.name === "string" && updatedWatchQuery.name !== body.name) {
      updatedWatchQuery.name = body.name;
      changedFields.push("name");
    }

    if (typeof body.feedUrl === "string" && updatedWatchQuery.feedUrl !== body.feedUrl) {
      updatedWatchQuery.feedUrl = body.feedUrl;
      changedFields.push("feedUrl");
    }

    const savedWatchQuery = await server.persistence.configuration.saveWatchQuery(updatedWatchQuery);

    recordAuditEvent({
      type: "CONFIGURATION_CHANGED",
      actor: body.actor ?? "local-prototype-user",
      payload: {
        configurationType: "Watch Query",
        watchQueryId: savedWatchQuery.id,
        source: savedWatchQuery.source,
        changedFields
      }
    });

    return { watchQuery: savedWatchQuery };
  });
}

function buildWatchQueryId(feedUrl: string): string {
  const hash = cryptoHash(feedUrl).slice(0, 12);
  return `watch-query-rss-${hash}`;
}

function cryptoHash(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36).padStart(8, "0");
}
