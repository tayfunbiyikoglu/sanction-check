import type { FastifyInstance } from "fastify";
import { evaluateCompleteExtractionGate } from "../correction/complete-extraction-gate.js";
import {
  candidateLegalActs,
  correctionActions,
  configuredBaseActs,
  exportBatches,
  extractionResults,
  sanctionsDeltaRecords,
  watchQueries
} from "../seed-data.js";
import { evaluateReexportState } from "../export/service.js";

export async function registerCandidateRoutes(server: FastifyInstance) {
  server.get("/", async () => ({
    candidates: server.persistence.monitoring ? await server.persistence.monitoring.listCandidates() : candidateLegalActs
  }));

  server.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const candidates = server.persistence.monitoring ? await server.persistence.monitoring.listCandidates() : candidateLegalActs;
    const candidate = candidates.find((item) => item.id === id);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    const candidateExtractionResults = server.persistence.monitoring
      ? await server.persistence.monitoring.listExtractionResults(candidate.id)
      : extractionResults.filter((result) => result.candidateId === candidate.id);
    const latestExtractionResult = candidateExtractionResults.at(-1);
    const candidateRecords = server.persistence.monitoring
      ? await server.persistence.monitoring.listSanctionsDeltaRecords(candidate.id)
      : sanctionsDeltaRecords.filter((record) => record.candidateId === candidate.id);

    return {
      candidate,
      configuredBaseActs: server.persistence.mode === "postgres" ? await server.persistence.configuration.listConfiguredBaseActs() : configuredBaseActs,
      watchQueries: server.persistence.mode === "postgres" ? await server.persistence.configuration.listWatchQueries() : watchQueries,
      extractionResults: candidateExtractionResults,
      sanctionsDeltaRecords: candidateRecords,
      correctionActions: correctionActions.filter((action) => action.candidateId === candidate.id),
      exportBatches: exportBatches.filter((batch) => batch.candidateId === candidate.id),
      reexportState: evaluateReexportState({
        candidate,
        ...(latestExtractionResult ? { extractionResult: latestExtractionResult } : {}),
        records: candidateRecords,
        existingBatches: exportBatches
      }),
      completeExtractionGate: evaluateCompleteExtractionGate({
        candidate,
        ...(latestExtractionResult ? { extractionResult: latestExtractionResult } : {}),
        records: candidateRecords
      })
    };
  });
}
