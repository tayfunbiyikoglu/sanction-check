import path from "node:path";
import type { FastifyInstance } from "fastify";
import { candidateLegalActs, recordAuditEvent } from "../seed-data.js";
import {
  LiveCellarSourceContentAdapter,
  RecordedCellarSourceContentAdapter
} from "./cellar-source-adapter.js";
import { seededOfficialSourceFixtures } from "./mock-eurlex-cellar-adapter.js";
import { FilesystemSourceContentRepository } from "./source-content-repository.js";
import { SourceRetrievalService } from "./source-retrieval-service.js";
import { systemClock } from "./types.js";

export async function registerRetrievalRoutes(server: FastifyInstance) {
  const sourceContentRepository = buildSourceContentRepository();

  server.post("/candidates/:id/retrieve-source-content", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { mode?: "mock" | "live"; endpointUrl?: string; apiKey?: string };
    const persistedCandidate = server.persistence.monitoring
      ? await server.persistence.monitoring.getCandidate(id)
      : undefined;
    const candidateIndex = server.persistence.monitoring
      ? -1
      : candidateLegalActs.findIndex((candidate) => candidate.id === id);
    const candidate = persistedCandidate ?? (candidateIndex >= 0 ? candidateLegalActs[candidateIndex] : undefined);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    const retrievalService = new SourceRetrievalService(
      buildCellarSourceContentAdapter({
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.endpointUrl ? { endpointUrl: body.endpointUrl } : {}),
        ...(body.apiKey ? { apiKey: body.apiKey } : {})
      }),
      sourceContentRepository,
      systemClock
    );
    const retrieved = await retrievalService.retrieveEnglishSourceContent(candidate);

    if (server.persistence.monitoring) {
      await server.persistence.monitoring.updateCandidate(retrieved);
    } else {
      candidateLegalActs[candidateIndex] = retrieved;
    }

    recordAuditEvent({
      type: "RETRIEVAL_ATTEMPT_RECORDED",
      candidateId: retrieved.id,
      ...(retrieved.retrieval?.lastAttemptAt ? { occurredAt: retrieved.retrieval.lastAttemptAt } : {}),
      payload: {
        status: retrieved.retrieval?.status,
        attempts: retrieved.retrieval?.attempts,
        sourceContentReference: retrieved.sourceContent?.reference,
        contentHash: retrieved.sourceContent?.contentHash,
        contentType: retrieved.sourceContent?.contentType,
        failureCode: retrieved.retrieval?.failureCode,
        availableLanguageCount: retrieved.retrieval?.availableLanguages?.length
      }
    });

    return {
      candidate: retrieved,
      retrieval: retrieved.retrieval,
      sourceContent: retrieved.sourceContent
    };
  });

  server.get("/candidates/:id/source-content", async (request, reply) => {
    const { id } = request.params as { id: string };
    const candidate = server.persistence.monitoring
      ? await server.persistence.monitoring.getCandidate(id)
      : candidateLegalActs.find((item) => item.id === id);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    if (!candidate.sourceContent) {
      return reply.code(404).send({ message: "English source content has not been retrieved" });
    }

    return {
      candidateId: candidate.id,
      sourceContent: candidate.sourceContent,
      content: await sourceContentRepository.read(candidate.sourceContent.reference)
    };
  });
}

function buildSourceContentRepository() {
  return new FilesystemSourceContentRepository(
    process.env.SOURCE_CONTENT_STORAGE_DIR ?? path.resolve(process.cwd(), "../../storage/source-content")
  );
}

function buildCellarSourceContentAdapter(input: {
  mode?: "mock" | "live";
  endpointUrl?: string;
  apiKey?: string;
} = {}) {
  if ((input.mode ?? parseIntegrationMode(process.env.CELLAR_RETRIEVAL_MODE)) === "live") {
    return new LiveCellarSourceContentAdapter({
      endpointUrl: input.endpointUrl ?? process.env.CELLAR_ENDPOINT_URL,
      apiKey: input.apiKey ?? process.env.CELLAR_API_KEY
    });
  }

  return new RecordedCellarSourceContentAdapter(seededOfficialSourceFixtures);
}

function parseIntegrationMode(value: string | undefined): "mock" | "live" {
  return value === "live" ? "live" : "mock";
}
