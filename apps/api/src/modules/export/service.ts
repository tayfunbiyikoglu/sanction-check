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

const csvColumns = [
  "COUNTRYOFORIGIN",
  "ENTRYDATE",
  "FIRSTNAME",
  "GENDER",
  "ID",
  "ISDELETED",
  "JUSTIFICATION",
  "LEGALSTATUS",
  "NAME",
  "YEAR"
] as const;

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
  const csv = serializeAuditCsv({
    batch,
    candidate: input.candidate,
    extractionResult: input.extractionResult,
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

export function serializeAuditCsv(input: {
  batch: Pick<ExportBatch, "id"> & Partial<Pick<ExportBatch, "createdAt">>;
  candidate: CandidateLegalAct;
  extractionResult: ExtractionResult;
  records: SanctionsDeltaRecord[];
}): string {
  const exportDate = formatCompactDate(input.batch.createdAt ?? input.candidate.publicationDate);
  const rows = orderRecordsForExport(input.records).map((record, index) => {
    const nameParts = splitExportName(record);
    const legalStatus = record.recordType === "ENTITY" ? "LEGAL_ENTITY" : "NATURAL_PERSON";

    return [
      "",
      formatEntryDate(readListedEntryField(record, "dateoflisting") ?? input.candidate.publicationDate),
      nameParts.firstName,
      inferGender(record),
      `${exportDate}${String(index + 1).padStart(4, "0")}`,
      "FALSE",
      "",
      legalStatus,
      nameParts.name,
      ""
    ];
  });

  return [csvColumns.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n") + "\n";
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

export function orderRecordsForExport(records: SanctionsDeltaRecord[]): SanctionsDeltaRecord[] {
  return [...records].sort((left, right) => {
    return (
      left.sourceOrder - right.sourceOrder ||
      (left.affectedAnnex ?? "").localeCompare(right.affectedAnnex ?? "") ||
      (left.sourceLocation ?? "").localeCompare(right.sourceLocation ?? "") ||
      left.id.localeCompare(right.id)
    );
  });
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

function splitExportName(record: SanctionsDeltaRecord): { firstName: string; name: string } {
  const displayName = firstLine(readListedEntryField(record, "name") ?? record.primaryName).trim();

  if (record.recordType === "ENTITY") {
    return { firstName: "", name: displayName };
  }

  const parts = displayName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: "", name: displayName.toUpperCase() };
  }

  const surname = parts.at(-1) ?? "";
  return {
    firstName: parts.slice(0, -1).join(" "),
    name: surname.toUpperCase()
  };
}

function inferGender(record: SanctionsDeltaRecord): "MALE" | "FEMALE" | "NONE" {
  if (record.recordType === "ENTITY") {
    return "NONE";
  }

  const explicitGender = readListedEntryField(record, "gender")?.toLowerCase();
  if (explicitGender) {
    if (/\bfemale\b|\bwoman\b|\bwomen\b/.test(explicitGender)) {
      return "FEMALE";
    }

    if (/\bmale\b|\bman\b|\bmen\b/.test(explicitGender)) {
      return "MALE";
    }
  }

  const firstName = splitExportName(record).firstName.split(/\s+/)[0]?.toLowerCase() ?? "";
  const femaleFirstNames = new Set([
    "anastasia",
    "evgeniya",
    "irina",
    "lilya",
    "marina",
    "mariya",
    "natalya",
    "olga",
    "svetlana",
    "tatyana",
    "yulia"
  ]);

  if (femaleFirstNames.has(firstName) || /(?:a|aya|iya|ina|ovna|evna)$/.test(firstName)) {
    return "FEMALE";
  }

  return "MALE";
}

function readListedEntryField(record: SanctionsDeltaRecord, fieldName: string): string | undefined {
  const value = record.listedEntry?.[fieldName];

  if (Array.isArray(value)) {
    return value.join("; ");
  }

  return value;
}

function formatEntryDate(value: string | undefined): string {
  const date = parseDateParts(value);

  if (!date) {
    return "";
  }

  return `${date.year}-${date.month}-${date.day}`;
}

function formatCompactDate(value: string | undefined): string {
  const date = parseDateParts(value);

  if (!date) {
    return new Date().toISOString().slice(0, 10).replaceAll("-", "");
  }

  return `${date.year}${date.month}${date.day}`;
}

function parseDateParts(value: string | undefined): { year: string; month: string; day: string } | undefined {
  if (!value) {
    return undefined;
  }

  const isoMatch = value.match(/(?:^|\D)(\d{4})-(\d{2})-(\d{2})(?:\D|$)/);
  if (isoMatch) {
    return { year: isoMatch[1] ?? "", month: isoMatch[2] ?? "", day: isoMatch[3] ?? "" };
  }

  const dottedMatch = value.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (dottedMatch) {
    return {
      year: dottedMatch[3] ?? "",
      month: (dottedMatch[2] ?? "").padStart(2, "0"),
      day: (dottedMatch[1] ?? "").padStart(2, "0")
    };
  }

  return undefined;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() ?? "";
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\"", "\"\"")}"`;
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
