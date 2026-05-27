import { createHash, randomUUID } from "node:crypto";
import type {
  CandidateLegalAct,
  CompleteExtractionGateResult,
  ExportBatch,
  ExportBatchRecord,
  ExportDownloadEvent,
  ExtractionResult,
  SanctionsDeltaRecord
} from "@sanctions/domain";
import { resolveLegalActIdentity } from "@sanctions/domain";
import { orderRecordsForExport } from "./record-ordering.js";
import { serializeSanctionsUploadCsv } from "./sanctions-upload-csv.js";

export interface CreateExportBatchInput {
  candidate: CandidateLegalAct;
  extractionResult: ExtractionResult;
  records: SanctionsDeltaRecord[];
  completeExtractionGate: CompleteExtractionGateResult;
  existingBatches: ExportBatch[];
  actor: string;
  createdAt?: string;
  batchId?: string;
  reexportReason?: string;
}

export interface CreateExportBatchResult {
  batch: ExportBatch;
  recordLinks: ExportBatchRecord[];
  csv: string;
}

export interface ReexportState {
  currentExtractionSnapshotHash?: string;
  latestExportBatchId?: string;
  latestExportSnapshotHash?: string;
  reexportRequired: boolean;
}

export interface ExportBatchFile {
  batch: ExportBatch;
  csv: string;
}

export interface RecordDownloadInput {
  exportBatchId: string;
  actor: string;
  downloadedAt?: string;
  downloadId?: string;
}

export function createExportBatch(input: CreateExportBatchInput): CreateExportBatchResult {
  assertExportable(input);

  const existingForCandidate = input.existingBatches.filter((batch) => batch.candidateId === input.candidate.id);
  const latestBatch = existingForCandidate.at(-1);
  const reexportReason = input.reexportReason?.trim();
  const orderedRecords = orderRecordsForExport(input.records);
  const extractionSnapshotHash = hashExtractionSnapshot({
    candidate: input.candidate,
    extractionResult: input.extractionResult,
    records: orderedRecords
  });

  if (latestBatch) {
    if (latestBatch.extractionSnapshotHash === extractionSnapshotHash) {
      throw new ExportConflictError("Current complete extraction matches latest export batch; no re-export required");
    }

    if (!reexportReason) {
      throw new ExportConflictError("Current complete extraction differs from latest export batch; provide a re-export reason");
    }
  }

  const batchId = input.batchId ?? randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();

  const baseBatch = {
    id: batchId,
    candidateId: input.candidate.id,
    createdAt,
    createdBy: input.actor,
    status: "CREATED" as const,
    fileName: buildFileName(input.candidate, createdAt, latestBatch ? "reexport" : "export"),
    extractionSnapshotHash,
    recordCount: orderedRecords.length
  };

  const batch: ExportBatch = {
    ...baseBatch,
    fileHash: "",
    ...(latestBatch ? { reexportOfBatchId: latestBatch.id } : {}),
    ...(reexportReason ? { reexportReason } : {})
  };
  const csv = serializeSanctionsUploadCsv({
    batch,
    candidate: input.candidate,
    records: orderedRecords
  });
  batch.fileHash = sha256Hex(csv);

  return {
    batch,
    recordLinks: orderedRecords.map((record) => ({
      exportBatchId: batch.id,
      recordId: record.id
    })),
    csv
  };
}

export function hashExtractionSnapshot(input: {
  candidate: CandidateLegalAct;
  extractionResult: ExtractionResult;
  records: SanctionsDeltaRecord[];
}): string {
  const identity = resolveLegalActIdentity(input.candidate);
  return sha256Hex(
    stableStringify({
      candidate: {
        id: input.candidate.id,
        legalActIdentity: identity,
        workingLanguage: input.candidate.workingLanguage,
        sourceContent: input.candidate.sourceContent
          ? {
              contentHash: input.candidate.sourceContent.contentHash,
              contentType: input.candidate.sourceContent.contentType,
              language: input.candidate.sourceContent.language,
              reference: input.candidate.sourceContent.reference,
              sourceUri: input.candidate.sourceContent.sourceUri
            }
          : null
      },
      extraction: {
        parserVersion: input.extractionResult.parserVersion,
        classification: input.extractionResult.classification,
        annexFound: input.extractionResult.annexFound,
        annexHeading: input.extractionResult.annexHeading ?? null
      },
      records: orderRecordsForExport(input.records).map((record) => ({
        id: record.id,
        recordType: record.recordType,
        actionType: record.actionType,
        primaryName: record.primaryName,
        listedEntry: record.listedEntry ?? {},
        affectedAnnex: record.affectedAnnex ?? null,
        detectedBaseAct: record.detectedBaseAct ?? null,
        sourceOrder: record.sourceOrder,
        sourceLocation: record.sourceLocation ?? null,
        evidenceText: record.evidenceText,
        confidence: record.confidence
      }))
    })
  );
}

export function evaluateReexportState(input: {
  candidate: CandidateLegalAct;
  extractionResult?: ExtractionResult;
  records: SanctionsDeltaRecord[];
  existingBatches: ExportBatch[];
}): ReexportState {
  const latestBatch = input.existingBatches.filter((batch) => batch.candidateId === input.candidate.id).at(-1);

  if (!input.extractionResult) {
    return {
      ...(latestBatch
        ? {
            latestExportBatchId: latestBatch.id,
            latestExportSnapshotHash: latestBatch.extractionSnapshotHash
          }
        : {}),
      reexportRequired: false
    };
  }

  const currentExtractionSnapshotHash = hashExtractionSnapshot({
    candidate: input.candidate,
    extractionResult: input.extractionResult,
    records: input.records
  });

  return {
    currentExtractionSnapshotHash,
    ...(latestBatch
      ? {
          latestExportBatchId: latestBatch.id,
          latestExportSnapshotHash: latestBatch.extractionSnapshotHash
        }
      : {}),
    reexportRequired: Boolean(latestBatch && latestBatch.extractionSnapshotHash !== currentExtractionSnapshotHash)
  };
}

export function recordExportDownload(input: RecordDownloadInput): ExportDownloadEvent {
  return {
    id: input.downloadId ?? randomUUID(),
    exportBatchId: input.exportBatchId,
    downloadedAt: input.downloadedAt ?? new Date().toISOString(),
    downloadedBy: input.actor
  };
}

function assertExportable(input: CreateExportBatchInput) {
  if (!input.completeExtractionGate.ready) {
    throw new ExportBlockedError(input.completeExtractionGate.blockers);
  }

  if (input.extractionResult.classification !== "DELTA" || input.candidate.status === "NO_DELTA") {
    throw new ExportBlockedError(["Only complete candidate legal acts with sanctions delta records can be exported"]);
  }

  if (input.records.length === 0) {
    throw new ExportBlockedError(["No sanctions delta records have been extracted"]);
  }
}

function buildFileName(candidate: CandidateLegalAct, createdAt: string, kind: "export" | "reexport"): string {
  const identity = resolveLegalActIdentity(candidate);
  const timestamp = createdAt.replace(/[^0-9]/g, "").slice(0, 14);
  return `${identity.value.toLowerCase()}-${kind}-${timestamp}.csv`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

export class ExportBlockedError extends Error {
  constructor(readonly blockers: string[]) {
    super("Candidate legal act is not ready for export");
    this.name = "ExportBlockedError";
  }
}

export class ExportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportConflictError";
  }
}
