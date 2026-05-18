import type {
  CandidateLegalAct,
  ExtractionCorrectionAction,
  SanctionsDeltaRecord
} from "@sanctions/domain";
import { extractAnnexSanctionsDeltaRecords } from "../parser/annex-parser.js";
import type { ParserContentType } from "../parser/types.js";

const editableFields = new Set([
  "primaryName",
  "listedEntry",
  "affectedAnnex",
  "detectedBaseAct",
  "sourceLocation",
  "evidenceText"
]);

const parserOwnedFields = new Map([
  ["actionType", "Manual Delta Action changes are not allowed; fix parser rules and reprocess the candidate legal act"],
  [
    "recordType",
    "Manual person/entity reclassification is not allowed; fix parser rules and reprocess the candidate legal act"
  ]
]);

export class CorrectionPolicyError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "CorrectionPolicyError";
  }
}

export interface SourceBackedFieldCorrectionInput {
  candidate: CandidateLegalAct;
  records: SanctionsDeltaRecord[];
  correctionActions: ExtractionCorrectionAction[];
  recordId: string;
  actor: string;
  fields: Record<string, unknown>;
  evidenceText: string;
  sourceLocation: string;
  sourceContent: string;
  occurredAt: string;
  comment?: string;
}

export interface MissedRecordAdditionInput {
  candidate: CandidateLegalAct;
  records: SanctionsDeltaRecord[];
  correctionActions: ExtractionCorrectionAction[];
  actor: string;
  sourceLocation: string;
  sourceContent: string;
  contentType: ParserContentType;
  occurredAt: string;
  comment?: string;
}

export function applySourceBackedFieldCorrection(
  input: SourceBackedFieldCorrectionInput
): { record: SanctionsDeltaRecord; correctionAction: ExtractionCorrectionAction } {
  ensureCandidateHasSource(input.candidate);
  ensureActor(input.actor);
  ensureEvidenceBacked(input.sourceContent, input.evidenceText, input.sourceLocation);

  const record = input.records.find((item) => item.id === input.recordId && item.candidateId === input.candidate.id);

  if (!record) {
    throw new CorrectionPolicyError(404, "Sanctions delta record not found");
  }

  const fieldNames = Object.keys(input.fields);

  if (fieldNames.length === 0) {
    throw new CorrectionPolicyError(400, "At least one extracted field correction is required");
  }

  for (const fieldName of fieldNames) {
    const parserOwnedMessage = parserOwnedFields.get(fieldName);
    if (parserOwnedMessage) {
      throw new CorrectionPolicyError(409, parserOwnedMessage);
    }

    if (!editableFields.has(fieldName)) {
      throw new CorrectionPolicyError(400, `Field ${fieldName} cannot be corrected manually`);
    }
  }

  const beforeValues = pickValues(record, fieldNames);

  for (const fieldName of fieldNames) {
    setEditableValue(record, fieldName, input.fields[fieldName]);
  }

  const correctionAction = appendCorrectionAction(input.correctionActions, {
    id: nextCorrectionActionId(input.correctionActions),
    candidateId: input.candidate.id,
    recordId: record.id,
    actionType: "FIELD_CORRECTION",
    actor: input.actor,
    occurredAt: input.occurredAt,
    beforeValues,
    afterValues: pickValues(record, fieldNames),
    evidenceText: input.evidenceText,
    sourceLocation: input.sourceLocation,
    ...(input.comment ? { comment: input.comment } : {})
  });

  return { record, correctionAction };
}

export function addMissedRecordFromSourceContext(
  input: MissedRecordAdditionInput
): { record: SanctionsDeltaRecord; correctionAction: ExtractionCorrectionAction } {
  ensureCandidateHasSource(input.candidate);
  ensureActor(input.actor);

  if (input.contentType !== "application/xml") {
    throw new CorrectionPolicyError(
      409,
      "Selected source context cannot infer Delta Action and person/entity classification"
    );
  }

  const parsed = extractAnnexSanctionsDeltaRecords({
    candidateId: input.candidate.id,
    content: input.sourceContent,
    contentType: input.contentType,
    sourceUri: input.candidate.sourceContent?.sourceUri
  });
  const missedRecord = parsed.records.find((record) => record.sourceLocation === input.sourceLocation);

  if (!missedRecord) {
    throw new CorrectionPolicyError(
      409,
      "Selected source context cannot infer Delta Action and person/entity classification"
    );
  }

  ensureEvidenceBacked(input.sourceContent, missedRecord.evidenceText, missedRecord.sourceLocation ?? input.sourceLocation);

  if (input.records.some((record) => record.candidateId === input.candidate.id && record.sourceLocation === input.sourceLocation)) {
    throw new CorrectionPolicyError(409, "A sanctions delta record already exists for the selected source context");
  }

  input.records.push(missedRecord);

  const correctionAction = appendCorrectionAction(input.correctionActions, {
    id: nextCorrectionActionId(input.correctionActions),
    candidateId: input.candidate.id,
    recordId: missedRecord.id,
    actionType: "MISSED_RECORD_ADDITION",
    actor: input.actor,
    occurredAt: input.occurredAt,
    beforeValues: {},
    afterValues: { record: missedRecord },
    evidenceText: missedRecord.evidenceText,
    sourceLocation: missedRecord.sourceLocation ?? input.sourceLocation,
    ...(input.comment ? { comment: input.comment } : {})
  });

  return { record: missedRecord, correctionAction };
}

export function rejectManualFalsePositiveDeletion(): never {
  throw new CorrectionPolicyError(
    409,
    "Manual false-positive deletion is not allowed; fix parser rules and reprocess the candidate legal act"
  );
}

export function rejectManualActionTypeChange(): never {
  throw new CorrectionPolicyError(
    409,
    "Manual Delta Action changes are not allowed; fix parser rules and reprocess the candidate legal act"
  );
}

export function rejectManualRecordTypeChange(): never {
  throw new CorrectionPolicyError(
    409,
    "Manual person/entity reclassification is not allowed; fix parser rules and reprocess the candidate legal act"
  );
}

function ensureCandidateHasSource(candidate: CandidateLegalAct) {
  if (!candidate.sourceContent) {
    throw new CorrectionPolicyError(409, "Official English source content has not been retrieved");
  }
}

function ensureActor(actor: string) {
  if (!actor.trim()) {
    throw new CorrectionPolicyError(400, "Correction actor is required");
  }
}

function ensureEvidenceBacked(sourceContent: string, evidenceText: string, sourceLocation: string) {
  if (!evidenceText.trim()) {
    throw new CorrectionPolicyError(400, "Evidence Text is required");
  }

  if (!sourceLocation.trim()) {
    throw new CorrectionPolicyError(400, "Source location is required");
  }

  if (!normalizeForEvidence(sourceContent).includes(normalizeForEvidence(evidenceText))) {
    throw new CorrectionPolicyError(409, "Correction evidence must be selected from official source content");
  }
}

function pickValues(record: SanctionsDeltaRecord, fields: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const field of fields) {
    values[field] = record[field as keyof SanctionsDeltaRecord];
  }

  return values;
}

function setEditableValue(record: SanctionsDeltaRecord, fieldName: string, value: unknown) {
  switch (fieldName) {
    case "primaryName":
    case "affectedAnnex":
    case "detectedBaseAct":
    case "sourceLocation":
    case "evidenceText":
      if (typeof value !== "string") {
        throw new CorrectionPolicyError(400, `Field ${fieldName} must be a string`);
      }
      record[fieldName] = value;
      return;
    case "listedEntry":
      if (!isListedEntry(value)) {
        throw new CorrectionPolicyError(400, "Field listedEntry must be a source field object");
      }
      record.listedEntry = value;
      return;
    default:
      throw new CorrectionPolicyError(400, `Field ${fieldName} cannot be corrected manually`);
  }
}

function isListedEntry(value: unknown): value is Record<string, string | string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (item) => typeof item === "string" || (Array.isArray(item) && item.every((nested) => typeof nested === "string"))
  );
}

function appendCorrectionAction(
  correctionActions: ExtractionCorrectionAction[],
  action: ExtractionCorrectionAction
): ExtractionCorrectionAction {
  correctionActions.push(action);
  return action;
}

function nextCorrectionActionId(correctionActions: ExtractionCorrectionAction[]): string {
  return `correction-action-${(correctionActions.length + 1).toString().padStart(3, "0")}`;
}

function normalizeForEvidence(value: string): string {
  return decodeXmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}
