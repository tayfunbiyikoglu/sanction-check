import type { FastifyInstance } from "fastify";
import {
  candidateLegalActs,
  correctionActions,
  configuredBaseActs,
  exportBatches,
  extractionResults,
  recordReviews,
  sanctionsDeltaRecords,
  watchQueries
} from "../seed-data.js";
import { buildCandidateLegalActWorkbenchDetail } from "../evidence-workbench/read-model.js";

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
    const candidateRecords = server.persistence.monitoring
      ? await server.persistence.monitoring.listSanctionsDeltaRecords(candidate.id)
      : sanctionsDeltaRecords.filter((record) => record.candidateId === candidate.id);
    const candidateCorrectionActions = server.persistence.monitoring
      ? await server.persistence.monitoring.listCorrectionActions(candidate.id)
      : correctionActions;
    const candidateRecordReviews = server.persistence.monitoring
      ? await server.persistence.monitoring.listRecordReviews(candidate.id)
      : recordReviews.filter((review) => review.candidateId === candidate.id);
    const allExportBatches = server.persistence.exports ? await server.persistence.exports.listExportBatches() : exportBatches;

    return buildCandidateLegalActWorkbenchDetail({
      candidate,
      configuredBaseActs: server.persistence.mode === "postgres" ? await server.persistence.configuration.listConfiguredBaseActs() : configuredBaseActs,
      watchQueries: server.persistence.mode === "postgres" ? await server.persistence.configuration.listWatchQueries() : watchQueries,
      extractionResults: candidateExtractionResults,
      sanctionsDeltaRecords: candidateRecords,
      recordReviews: candidateRecordReviews,
      correctionActions: candidateCorrectionActions,
      exportBatches: allExportBatches
    });
  });
}
