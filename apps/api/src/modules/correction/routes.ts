import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  candidateLegalActs,
  correctionActions,
  recordAuditEvent,
  sanctionsDeltaRecords
} from "../seed-data.js";
import { FilesystemSourceContentRepository } from "../retrieval/source-content-repository.js";
import {
  addMissedRecordFromSourceContext,
  applySourceBackedFieldCorrection,
  CorrectionPolicyError,
  rejectManualActionTypeChange,
  rejectManualFalsePositiveDeletion,
  rejectManualRecordTypeChange
} from "./service.js";

interface FieldCorrectionPayload {
  actor?: unknown;
  fields?: unknown;
  evidenceText?: unknown;
  sourceLocation?: unknown;
  comment?: unknown;
}

interface MissedRecordPayload {
  actor?: unknown;
  sourceLocation?: unknown;
  comment?: unknown;
}

export async function registerCorrectionRoutes(server: FastifyInstance) {
  const sourceContentRepository = buildSourceContentRepository();

  server.get("/candidates/:id/actions", async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!candidateLegalActs.some((candidate) => candidate.id === id)) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    return {
      correctionActions: correctionActions.filter((action) => action.candidateId === id)
    };
  });

  server.patch("/candidates/:candidateId/records/:recordId/source-backed-fields", async (request, reply) => {
    const { candidateId, recordId } = request.params as { candidateId: string; recordId: string };
    const candidate = candidateLegalActs.find((item) => item.id === candidateId);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    const payload = request.body as FieldCorrectionPayload;

    try {
      const sourceContent = await readSourceContent(sourceContentRepository, candidate);
      const result = applySourceBackedFieldCorrection({
        candidate,
        records: sanctionsDeltaRecords,
        correctionActions,
        recordId,
        actor: stringValue(payload.actor, "actor"),
        fields: objectValue(payload.fields, "fields"),
        evidenceText: stringValue(payload.evidenceText, "evidenceText"),
        sourceLocation: stringValue(payload.sourceLocation, "sourceLocation"),
        sourceContent,
        occurredAt: new Date().toISOString(),
        ...optionalComment(payload.comment)
      });
      recordAuditEvent({
        type: "EXTRACTION_CORRECTION_RECORDED",
        actor: result.correctionAction.actor,
        candidateId,
        occurredAt: result.correctionAction.occurredAt,
        payload: {
          correctionActionId: result.correctionAction.id,
          correctionActionType: result.correctionAction.actionType,
          recordId: result.correctionAction.recordId,
          fieldNames: Object.keys(objectValue(payload.fields, "fields")),
          sourceLocation: result.correctionAction.sourceLocation,
          hasComment: Boolean(result.correctionAction.comment)
        }
      });
      return result;
    } catch (cause) {
      return sendCorrectionError(reply, cause);
    }
  });

  server.post("/candidates/:candidateId/missed-records", async (request, reply) => {
    const { candidateId } = request.params as { candidateId: string };
    const candidate = candidateLegalActs.find((item) => item.id === candidateId);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    const payload = request.body as MissedRecordPayload;

    try {
      const sourceContent = await readSourceContent(sourceContentRepository, candidate);
      const result = addMissedRecordFromSourceContext({
        candidate,
        records: sanctionsDeltaRecords,
        correctionActions,
        actor: stringValue(payload.actor, "actor"),
        sourceLocation: stringValue(payload.sourceLocation, "sourceLocation"),
        sourceContent,
        contentType: candidate.sourceContent?.contentType ?? "text/plain",
        occurredAt: new Date().toISOString(),
        ...optionalComment(payload.comment)
      });
      recordAuditEvent({
        type: "EXTRACTION_CORRECTION_RECORDED",
        actor: result.correctionAction.actor,
        candidateId,
        occurredAt: result.correctionAction.occurredAt,
        payload: {
          correctionActionId: result.correctionAction.id,
          correctionActionType: result.correctionAction.actionType,
          recordId: result.correctionAction.recordId,
          sourceLocation: result.correctionAction.sourceLocation,
          hasComment: Boolean(result.correctionAction.comment)
        }
      });
      return result;
    } catch (cause) {
      return sendCorrectionError(reply, cause);
    }
  });

  server.delete("/candidates/:candidateId/records/:recordId", async (_request, reply) => {
    try {
      rejectManualFalsePositiveDeletion();
    } catch (cause) {
      return sendCorrectionError(reply, cause);
    }
  });

  server.patch("/candidates/:candidateId/records/:recordId/action-type", async (_request, reply) => {
    try {
      rejectManualActionTypeChange();
    } catch (cause) {
      return sendCorrectionError(reply, cause);
    }
  });

  server.patch("/candidates/:candidateId/records/:recordId/record-type", async (_request, reply) => {
    try {
      rejectManualRecordTypeChange();
    } catch (cause) {
      return sendCorrectionError(reply, cause);
    }
  });
}

async function readSourceContent(
  sourceContentRepository: FilesystemSourceContentRepository,
  candidate: (typeof candidateLegalActs)[number]
) {
  if (!candidate.sourceContent) {
    throw new CorrectionPolicyError(409, "Official English source content has not been retrieved");
  }

  return sourceContentRepository.read(candidate.sourceContent.reference);
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new CorrectionPolicyError(400, `${fieldName} must be a string`);
  }

  return value;
}

function objectValue(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CorrectionPolicyError(400, `${fieldName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function optionalComment(value: unknown): { comment?: string } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "string") {
    throw new CorrectionPolicyError(400, "comment must be a string");
  }

  return value ? { comment: value } : {};
}

function sendCorrectionError(reply: FastifyReply, cause: unknown) {
  if (cause instanceof CorrectionPolicyError) {
    return reply.code(cause.statusCode).send({ message: cause.message });
  }

  throw cause;
}

function buildSourceContentRepository() {
  return new FilesystemSourceContentRepository(
    process.env.SOURCE_CONTENT_STORAGE_DIR ?? path.resolve(process.cwd(), "../../storage/source-content")
  );
}
