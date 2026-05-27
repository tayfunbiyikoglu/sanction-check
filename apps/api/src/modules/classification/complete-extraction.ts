import { randomUUID } from "node:crypto";
import type { CandidateLegalAct, ExportBatch, ExtractionResult, SanctionsDeltaRecord } from "@sanctions/domain";
import { evaluateReexportState, type ReexportState } from "../export/service.js";
import { extractAnnexSanctionsDeltaRecords } from "../parser/annex-parser.js";
import { classifyCandidateLegalAct } from "./service.js";

export interface CompleteExtractionResult {
  candidate: CandidateLegalAct;
  extractionResult: ExtractionResult;
  records: SanctionsDeltaRecord[];
  reexportState: ReexportState;
}

export function runDeterministicCompleteExtraction(input: {
  candidate: CandidateLegalAct;
  content: string;
  createdAt: string;
  existingBatches: ExportBatch[];
}): CompleteExtractionResult {
  const sourceContent = input.candidate.sourceContent;

  if (!sourceContent) {
    throw new CompleteExtractionError("Official English source content has not been retrieved");
  }

  const classified = classifyCandidateLegalAct({
    candidate: input.candidate,
    content: input.content,
    createdAt: input.createdAt
  });
  let records: SanctionsDeltaRecord[] = [];

  if (
    classified.extractionResult.classification === "DELTA" &&
    (sourceContent.contentType === "application/xml" || sourceContent.contentType === "text/html")
  ) {
    const parsed = extractAnnexSanctionsDeltaRecords({
      candidateId: input.candidate.id,
      content: input.content,
      contentType: sourceContent.contentType,
      sourceUri: sourceContent.sourceUri
    });
    records = parsed.records;

    if (parsed.isComplete) {
      classified.candidate.status = "EXTRACTED_COMPLETE";
      classified.extractionResult.isComplete = true;
      classified.extractionResult.parserVersion = parsed.parserVersion;
    }
  }

  classified.extractionResult.id = createExtractionResultId(input.candidate, classified.extractionResult.parserVersion);

  return applyReexportState({
    candidate: classified.candidate,
    extractionResult: classified.extractionResult,
    records,
    existingBatches: input.existingBatches
  });
}

export function finalizeAssistedCompleteExtraction(input: {
  candidate: CandidateLegalAct;
  extractionResult: ExtractionResult;
  records: SanctionsDeltaRecord[];
  existingBatches: ExportBatch[];
}): CompleteExtractionResult {
  return applyReexportState(input);
}

export function scopeRecordsToExtraction(input: {
  extractionResult: ExtractionResult;
  records: SanctionsDeltaRecord[];
}): SanctionsDeltaRecord[] {
  return input.records.map((record) => ({
    ...record,
    id: `${input.extractionResult.id}-${record.id}`
  }));
}

function applyReexportState(input: {
  candidate: CandidateLegalAct;
  extractionResult: ExtractionResult;
  records: SanctionsDeltaRecord[];
  existingBatches: ExportBatch[];
}): CompleteExtractionResult {
  const reexportState = evaluateReexportState({
    candidate: input.candidate,
    extractionResult: input.extractionResult,
    records: input.records,
    existingBatches: input.existingBatches
  });
  const candidate = { ...input.candidate };

  if (reexportState.reexportRequired) {
    candidate.status = "REEXPORT_REQUIRED";
  } else if (reexportState.latestExportBatchId && candidate.status === "EXTRACTED_COMPLETE") {
    candidate.status = "EXPORTED";
  }

  return {
    candidate,
    extractionResult: input.extractionResult,
    records: input.records,
    reexportState
  };
}

function createExtractionResultId(candidate: CandidateLegalAct, parserVersion: string): string {
  return ["extraction", candidate.id, parserVersion, randomUUID()].join("-");
}

export class CompleteExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompleteExtractionError";
  }
}
