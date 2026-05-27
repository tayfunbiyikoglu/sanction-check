import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  candidateLegalActs,
  exportBatches,
  extractionResults,
  sanctionsDeltaRecords,
  recordAuditEvent,
  upsertSanctionsDeltaRecords,
  upsertCandidateLegalAct,
  upsertExtractionResult
} from "../seed-data.js";
import { FilesystemSourceContentRepository } from "../retrieval/source-content-repository.js";
import {
  AiExtractionConfigurationError,
  AiExtractionProviderError,
  extractSanctionsDeltaRecordsWithAi
} from "./ai-extraction-service.js";
import {
  CompleteExtractionError,
  finalizeAssistedCompleteExtraction,
  runDeterministicCompleteExtraction,
  scopeRecordsToExtraction,
  type CompleteExtractionResult
} from "./complete-extraction.js";

export async function registerClassificationRoutes(server: FastifyInstance) {
  const sourceContentRepository = buildSourceContentRepository();

  server.post("/candidates/:id/classify-source-content", async (request, reply) => {
    const { id } = request.params as { id: string };
    const candidate = server.persistence.monitoring
      ? await server.persistence.monitoring.getCandidate(id)
      : candidateLegalActs.find((item) => item.id === id);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    if (!candidate.sourceContent) {
      return reply.code(409).send({ message: "Official English source content has not been retrieved" });
    }

    const classified = await extractCandidateSourceContent({
      candidate,
      existingBatches: await listExportBatches(server),
      sourceContentRepository,
      createdAt: new Date().toISOString()
    });
    await persistExtractionIfNeeded(server, classified);

    appendParsingFailureAuditEvent(classified);

    return classified;
  });

  server.post("/candidates/:id/reprocess-source-content", async (request, reply) => {
    const { id } = request.params as { id: string };
    const candidate = server.persistence.monitoring
      ? await server.persistence.monitoring.getCandidate(id)
      : candidateLegalActs.find((item) => item.id === id);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    if (!candidate.sourceContent) {
      return reply.code(409).send({ message: "Official English source content has not been retrieved" });
    }

    const classified = await extractCandidateSourceContent({
      candidate,
      existingBatches: await listExportBatches(server),
      sourceContentRepository,
      createdAt: new Date().toISOString()
    });
    await persistExtractionIfNeeded(server, classified);

    recordAuditEvent({
      type: "CANDIDATE_REPROCESSED",
      candidateId: candidate.id,
      occurredAt: classified.extractionResult.createdAt,
      payload: {
        parserVersion: classified.extractionResult.parserVersion,
        classification: classified.extractionResult.classification,
        isComplete: classified.extractionResult.isComplete,
        reexportRequired: classified.reexportState.reexportRequired,
        latestExportBatchId: classified.reexportState.latestExportBatchId
      }
    });
    appendParsingFailureAuditEvent(classified);

    return {
      ...classified,
      reprocessed: true
    };
  });

  server.post("/candidates/:id/ai-extract-source-content", async (request, reply) => {
    const { id } = request.params as { id: string };
    const candidate = server.persistence.monitoring
      ? await server.persistence.monitoring.getCandidate(id)
      : candidateLegalActs.find((item) => item.id === id);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    if (!candidate.sourceContent) {
      return reply.code(409).send({ message: "Official English source content has not been retrieved" });
    }

    try {
      const content = await sourceContentRepository.read(candidate.sourceContent.reference);
      const extracted = await extractSanctionsDeltaRecordsWithAi({
        candidate,
        content,
        createdAt: new Date().toISOString()
      });
      const completed = finalizeAssistedCompleteExtraction({
        candidate: extracted.candidate,
        extractionResult: extracted.extractionResult,
        records: extracted.records,
        existingBatches: await listExportBatches(server)
      });

      if (server.persistence.monitoring) {
        await server.persistence.monitoring.saveExtractionResult({
          candidate: completed.candidate,
          extractionResult: completed.extractionResult,
          records: scopeRecordsToExtraction(completed)
        });
      } else {
        upsertCandidateLegalAct(completed.candidate);
        upsertExtractionResult(completed.extractionResult);
        upsertSanctionsDeltaRecords(candidate.id, completed.records);
      }

      recordAuditEvent({
        type: "CANDIDATE_REPROCESSED",
        candidateId: candidate.id,
        occurredAt: extracted.extractionResult.createdAt,
        payload: {
          parserVersion: completed.extractionResult.parserVersion,
          classification: completed.extractionResult.classification,
          isComplete: completed.extractionResult.isComplete,
          recordCount: completed.records.length,
          aiAssisted: true
        }
      });

      return {
        ...completed,
        aiAssisted: true
      };
    } catch (cause) {
      if (cause instanceof AiExtractionConfigurationError) {
        return reply.code(409).send({ message: cause.message });
      }

      if (cause instanceof AiExtractionProviderError) {
        return reply.code(502).send({ message: cause.message });
      }

      throw cause;
    }
  });

  server.get("/candidates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const candidate = server.persistence.monitoring
      ? await server.persistence.monitoring.getCandidate(id)
      : candidateLegalActs.find((item) => item.id === id);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    return {
      candidate,
      extractionResults: server.persistence.monitoring
        ? await server.persistence.monitoring.listExtractionResults(candidate.id)
        : extractionResults.filter((result) => result.candidateId === candidate.id)
    };
  });
}

function appendParsingFailureAuditEvent(classified: Awaited<ReturnType<typeof extractCandidateSourceContent>>) {
  if (classified.extractionResult.classification !== "PARSING_FAILED") {
    return;
  }

  recordAuditEvent({
    type: "PARSING_FAILURE_RECORDED",
    candidateId: classified.candidate.id,
    occurredAt: classified.extractionResult.createdAt,
    payload: {
      parserVersion: classified.extractionResult.parserVersion,
      extractionResultId: classified.extractionResult.id,
      classification: classified.extractionResult.classification,
      annexFound: classified.extractionResult.annexFound
    }
  });
}

async function extractCandidateSourceContent(input: {
  candidate: (typeof candidateLegalActs)[number];
  existingBatches: typeof exportBatches;
  sourceContentRepository: FilesystemSourceContentRepository;
  createdAt: string;
}): Promise<CompleteExtractionResult> {
  if (!input.candidate.sourceContent) {
    throw new CompleteExtractionError("Official English source content has not been retrieved");
  }

  const content = await input.sourceContentRepository.read(input.candidate.sourceContent.reference);
  const classified = runDeterministicCompleteExtraction({
    candidate: input.candidate,
    content,
    createdAt: input.createdAt,
    existingBatches: input.existingBatches
  });

  upsertCandidateLegalAct(classified.candidate);
  upsertExtractionResult(classified.extractionResult);
  upsertSanctionsDeltaRecords(input.candidate.id, classified.records);

  return classified;
}

async function persistExtractionIfNeeded(
  server: FastifyInstance,
  classified: Awaited<ReturnType<typeof extractCandidateSourceContent>>
) {
  if (!server.persistence.monitoring) {
    return;
  }

  await server.persistence.monitoring.saveExtractionResult({
    candidate: classified.candidate,
    extractionResult: classified.extractionResult,
    records: scopeRecordsToExtraction(classified)
  });
}

async function listExportBatches(server: FastifyInstance) {
  return server.persistence.exports ? await server.persistence.exports.listExportBatches() : exportBatches;
}

function buildSourceContentRepository() {
  return new FilesystemSourceContentRepository(
    process.env.SOURCE_CONTENT_STORAGE_DIR ?? path.resolve(process.cwd(), "../../storage/source-content")
  );
}
