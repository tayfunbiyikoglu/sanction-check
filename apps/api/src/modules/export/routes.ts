import type { FastifyInstance } from "fastify";
import { evaluateCompleteExtractionGate } from "../correction/complete-extraction-gate.js";
import {
  candidateLegalActs,
  exportBatchFiles,
  exportBatchRecords,
  exportBatches,
  exportDownloadEvents,
  extractionResults,
  recordAuditEvent,
  recordExportBatch,
  recordExportDownload as persistExportDownload,
  sanctionsDeltaRecords,
  upsertCandidateLegalAct
} from "../seed-data.js";
import {
  createExportBatch,
  ExportBlockedError,
  ExportConflictError,
  recordExportDownload,
} from "./service.js";

export async function registerExportRoutes(server: FastifyInstance) {
  server.get("/batches", async () => ({
    exportBatches: server.persistence.exports ? await server.persistence.exports.listExportBatches() : exportBatches,
    exportBatchRecords: server.persistence.exports ? await server.persistence.exports.listExportBatchRecords() : exportBatchRecords,
    exportDownloadEvents: server.persistence.exports ? await server.persistence.exports.listExportDownloadEvents() : exportDownloadEvents
  }));

  server.post("/candidates/:id/batches", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { actor?: string; reexportReason?: string };
    const candidate = server.persistence.monitoring
      ? await server.persistence.monitoring.getCandidate(id)
      : candidateLegalActs.find((item) => item.id === id);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    const candidateExtractionResults = server.persistence.monitoring
      ? await server.persistence.monitoring.listExtractionResults(candidate.id)
      : extractionResults.filter((result) => result.candidateId === candidate.id);
    const latestExtractionResult = candidateExtractionResults.at(-1);
    const records = server.persistence.monitoring
      ? await server.persistence.monitoring.listSanctionsDeltaRecords(candidate.id)
      : sanctionsDeltaRecords.filter((record) => record.candidateId === candidate.id);
    const existingBatches = server.persistence.exports ? await server.persistence.exports.listExportBatches() : exportBatches;

    if (!latestExtractionResult) {
      return reply.code(409).send({ message: "Candidate legal act has not been classified" });
    }

    try {
      const result = createExportBatch({
        candidate,
        extractionResult: latestExtractionResult,
        records,
        completeExtractionGate: evaluateCompleteExtractionGate({
          candidate,
          extractionResult: latestExtractionResult,
          records
        }),
        existingBatches,
        actor: body.actor ?? "local-prototype-user",
        ...(body.reexportReason ? { reexportReason: body.reexportReason } : {})
      });

      if (server.persistence.exports) {
        await server.persistence.exports.saveExportBatch({
          batch: result.batch,
          recordLinks: result.recordLinks,
          csv: result.csv
        });
      } else {
        recordExportBatch(result.batch, result.recordLinks, result.csv);
      }

      if (server.persistence.monitoring) {
        await server.persistence.monitoring.updateCandidate({ ...candidate, status: "EXPORTED" });
      } else {
        upsertCandidateLegalAct({ ...candidate, status: "EXPORTED" });
      }

      recordAuditEvent({
        type: "EXPORT_BATCH_CREATED",
        actor: result.batch.createdBy,
        candidateId: candidate.id,
        exportBatchId: result.batch.id,
        occurredAt: result.batch.createdAt,
        payload: {
          fileName: result.batch.fileName,
          fileHash: result.batch.fileHash,
          extractionSnapshotHash: result.batch.extractionSnapshotHash,
          recordCount: result.batch.recordCount,
          reexportOfBatchId: result.batch.reexportOfBatchId,
          hasReexportReason: Boolean(result.batch.reexportReason)
        }
      });

      return reply.code(201).send({
        exportBatch: result.batch,
        exportBatchRecords: result.recordLinks,
        csv: result.csv
      });
    } catch (error) {
      if (error instanceof ExportBlockedError) {
        return reply.code(409).send({ message: error.message, blockers: error.blockers });
      }

      if (error instanceof ExportConflictError) {
        return reply.code(409).send({ message: error.message });
      }

      throw error;
    }
  });

  server.get("/batches/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const batch = server.persistence.exports
      ? await server.persistence.exports.getExportBatch(id)
      : exportBatches.find((item) => item.id === id);

    if (!batch) {
      return reply.code(404).send({ message: "Export batch not found" });
    }

    return {
      exportBatch: batch,
      exportBatchRecords: server.persistence.exports
        ? (await server.persistence.exports.listExportBatchRecords()).filter((record) => record.exportBatchId === batch.id)
        : exportBatchRecords.filter((record) => record.exportBatchId === batch.id),
      exportDownloadEvents: server.persistence.exports
        ? (await server.persistence.exports.listExportDownloadEvents()).filter((event) => event.exportBatchId === batch.id)
        : exportDownloadEvents.filter((event) => event.exportBatchId === batch.id)
    };
  });

  server.get("/batches/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { actor?: string };
    const batch = server.persistence.exports
      ? await server.persistence.exports.getExportBatch(id)
      : exportBatches.find((item) => item.id === id);

    if (!batch) {
      return reply.code(404).send({ message: "Export batch not found" });
    }

    const csv = server.persistence.exports
      ? await server.persistence.exports.getExportBatchCsv(batch.id)
      : exportBatchFiles.find((file) => file.exportBatchId === batch.id)?.csv;

    if (!csv) {
      return reply.code(409).send({ message: "Export batch file is not available" });
    }

    const downloadEvent = recordExportDownload({
      exportBatchId: batch.id,
      actor: query.actor ?? "local-prototype-user"
    });

    if (server.persistence.exports) {
      await server.persistence.exports.saveExportDownload(downloadEvent);
    } else {
      persistExportDownload(downloadEvent);
    }
    recordAuditEvent({
      type: "EXPORT_BATCH_DOWNLOADED",
      actor: downloadEvent.downloadedBy,
      candidateId: batch.candidateId,
      exportBatchId: batch.id,
      occurredAt: downloadEvent.downloadedAt,
      payload: {
        downloadEventId: downloadEvent.id,
        fileName: batch.fileName,
        fileHash: batch.fileHash
      }
    });

    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${batch.fileName}"`)
      .send(csv);
  });
}
