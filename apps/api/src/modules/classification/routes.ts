import path from "node:path";
import { randomUUID } from "node:crypto";
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
import { classifyCandidateLegalAct } from "./service.js";
import { extractAnnexSanctionsDeltaRecords } from "../parser/annex-parser.js";
import { evaluateReexportState } from "../export/service.js";
import {
  AiExtractionConfigurationError,
  AiExtractionProviderError,
  extractSanctionsDeltaRecordsWithAi
} from "./ai-extraction-service.js";

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
      const reexportState = evaluateReexportState({
        candidate: extracted.candidate,
        extractionResult: extracted.extractionResult,
        records: extracted.records,
        existingBatches: exportBatches
      });

      if (reexportState.reexportRequired) {
        extracted.candidate.status = "REEXPORT_REQUIRED";
      }

      if (server.persistence.monitoring) {
        await server.persistence.monitoring.saveExtractionResult({
          candidate: extracted.candidate,
          extractionResult: extracted.extractionResult,
          records: extracted.records.map((record) => ({
            ...record,
            id: `${extracted.extractionResult.id}-${record.id}`
          }))
        });
      } else {
        upsertCandidateLegalAct(extracted.candidate);
        upsertExtractionResult(extracted.extractionResult);
        upsertSanctionsDeltaRecords(candidate.id, extracted.records);
      }

      recordAuditEvent({
        type: "CANDIDATE_REPROCESSED",
        candidateId: candidate.id,
        occurredAt: extracted.extractionResult.createdAt,
        payload: {
          parserVersion: extracted.extractionResult.parserVersion,
          classification: extracted.extractionResult.classification,
          isComplete: extracted.extractionResult.isComplete,
          recordCount: extracted.records.length,
          aiAssisted: true
        }
      });

      return {
        ...extracted,
        reexportState,
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
  sourceContentRepository: FilesystemSourceContentRepository;
  createdAt: string;
}) {
  const content = await input.sourceContentRepository.read(input.candidate.sourceContent!.reference);
  const classified = classifyCandidateLegalAct({
    candidate: input.candidate,
    content,
    createdAt: input.createdAt
  });

  if (
    classified.extractionResult.classification === "DELTA" &&
    (input.candidate.sourceContent!.contentType === "application/xml" ||
      input.candidate.sourceContent!.contentType === "text/html")
  ) {
    const parsed = extractAnnexSanctionsDeltaRecords({
      candidateId: input.candidate.id,
      content,
      contentType: input.candidate.sourceContent!.contentType,
      sourceUri: input.candidate.sourceContent!.sourceUri
    });

    upsertSanctionsDeltaRecords(input.candidate.id, parsed.records);

    if (parsed.isComplete) {
      classified.candidate.status = "EXTRACTED_COMPLETE";
      classified.extractionResult.isComplete = true;
      classified.extractionResult.parserVersion = parsed.parserVersion;
    }
  }

  classified.extractionResult.id = [
    "extraction",
    input.candidate.id,
    classified.extractionResult.parserVersion,
    randomUUID()
  ].join("-");

  const candidateRecords = sanctionsDeltaRecords.filter((record) => record.candidateId === input.candidate.id);
  const reexportState = evaluateReexportState({
    candidate: classified.candidate,
    extractionResult: classified.extractionResult,
    records: candidateRecords,
    existingBatches: exportBatches
  });

  if (reexportState.reexportRequired) {
    classified.candidate.status = "REEXPORT_REQUIRED";
  } else if (reexportState.latestExportBatchId && classified.candidate.status === "EXTRACTED_COMPLETE") {
    classified.candidate.status = "EXPORTED";
  }

  upsertCandidateLegalAct(classified.candidate);
  upsertExtractionResult(classified.extractionResult);

  return {
    ...classified,
    records: candidateRecords,
    reexportState
  };
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
    records: classified.records.map((record) => ({
      ...record,
      id: `${classified.extractionResult.id}-${record.id}`
    }))
  });
}

function buildSourceContentRepository() {
  return new FilesystemSourceContentRepository(
    process.env.SOURCE_CONTENT_STORAGE_DIR ?? path.resolve(process.cwd(), "../../storage/source-content")
  );
}
