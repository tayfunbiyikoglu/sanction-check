import type { RecordReviewDecision, SanctionsDeltaRecordReview } from "@sanctions/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  candidateLegalActs,
  correctionActions,
  extractionResults,
  exportBatches,
  recordReviews,
  recordAuditEvent,
  sanctionsDeltaRecords,
  upsertCandidateLegalAct,
  upsertExtractionResult
} from "../seed-data.js";
import { evaluateCompleteExtractionGate } from "./complete-extraction-gate.js";
import { buildSourceContentRepository } from "../retrieval/source-content-repository.js";
import type { SourceContentRepository } from "../retrieval/types.js";
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

interface MarkCompletePayload {
  actor?: unknown;
  comment?: unknown;
}

interface RecordReviewPayload {
  actor?: unknown;
  decision?: unknown;
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

  server.post("/candidates/:candidateId/mark-complete", async (request, reply) => {
    const { candidateId } = request.params as { candidateId: string };
    const candidate = server.persistence.monitoring
      ? await server.persistence.monitoring.getCandidate(candidateId)
      : candidateLegalActs.find((item) => item.id === candidateId);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    const payload = request.body as MarkCompletePayload;

    try {
      const actor = stringValue(payload.actor, "actor");
      if (!actor.trim()) {
        throw new CorrectionPolicyError(400, "Correction actor is required");
      }

      const candidateExtractionResults = server.persistence.monitoring
        ? await server.persistence.monitoring.listExtractionResults(candidate.id)
        : extractionResults.filter((result) => result.candidateId === candidate.id);
      const latestExtractionResult = candidateExtractionResults.at(-1);

      if (!latestExtractionResult) {
        throw new CorrectionPolicyError(409, "Candidate legal act has not been classified");
      }

      if (latestExtractionResult.isComplete) {
        throw new CorrectionPolicyError(409, "Latest extraction has already been marked complete");
      }

      const records = server.persistence.monitoring
        ? await server.persistence.monitoring.listSanctionsDeltaRecords(candidate.id)
        : sanctionsDeltaRecords.filter((record) => record.candidateId === candidate.id);
      const completionGate = evaluateCompleteExtractionGate({
        candidate: { ...candidate, status: "EXTRACTED_COMPLETE" },
        extractionResult: { ...latestExtractionResult, isComplete: true },
        records
      });

      if (!completionGate.ready) {
        throw new CorrectionPolicyError(
          409,
          `Complete extraction cannot be marked complete: ${completionGate.blockers.join("; ")}`
        );
      }

      const occurredAt = new Date().toISOString();
      const comment = optionalComment(payload.comment).comment;

      if (server.persistence.monitoring) {
        const correctionAction = await server.persistence.monitoring.markLatestExtractionComplete({
          candidate,
          extractionResult: latestExtractionResult,
          actor,
          occurredAt,
          ...(comment ? { comment } : {})
        });
        recordMarkCompleteAuditEvent(candidate.id, correctionAction);
        return {
          candidate: { ...candidate, status: "EXTRACTED_COMPLETE" },
          extractionResult: { ...latestExtractionResult, isComplete: true },
          correctionAction,
          completeExtractionGate: completionGate
        };
      }

      const completedCandidate = { ...candidate, status: "EXTRACTED_COMPLETE" as const };
      const completedExtractionResult = { ...latestExtractionResult, isComplete: true };
      const correctionAction = {
        id: `correction-action-${(correctionActions.length + 1).toString().padStart(3, "0")}`,
        candidateId: candidate.id,
        actionType: "MARK_EXTRACTION_COMPLETE" as const,
        actor,
        occurredAt,
        beforeValues: { isComplete: latestExtractionResult.isComplete, status: candidate.status },
        afterValues: { isComplete: true, status: completedCandidate.status },
        ...(comment ? { comment } : {})
      };

      upsertCandidateLegalAct(completedCandidate);
      upsertExtractionResult(completedExtractionResult);
      correctionActions.push(correctionAction);
      recordMarkCompleteAuditEvent(candidate.id, correctionAction);

      return {
        candidate: completedCandidate,
        extractionResult: completedExtractionResult,
        correctionAction,
        completeExtractionGate: completionGate
      };
    } catch (cause) {
      return sendCorrectionError(reply, cause);
    }
  });

  server.put("/candidates/:candidateId/records/:recordId/review", async (request, reply) => {
    const { candidateId, recordId } = request.params as { candidateId: string; recordId: string };
    const candidate = server.persistence.monitoring
      ? await server.persistence.monitoring.getCandidate(candidateId)
      : candidateLegalActs.find((item) => item.id === candidateId);

    if (!candidate) {
      return reply.code(404).send({ message: "Candidate legal act not found" });
    }

    const payload = request.body as RecordReviewPayload;

    try {
      const existingBatches = server.persistence.exports ? await server.persistence.exports.listExportBatches() : exportBatches;

      if (candidate.status === "EXPORTED" || existingBatches.some((batch) => batch.candidateId === candidate.id)) {
        throw new CorrectionPolicyError(409, "Record review is not available after export");
      }

      const actor = stringValue(payload.actor, "actor");
      if (!actor.trim()) {
        throw new CorrectionPolicyError(400, "Review actor is required");
      }

      const decision = reviewDecisionValue(payload.decision);
      const records = server.persistence.monitoring
        ? await server.persistence.monitoring.listSanctionsDeltaRecords(candidate.id)
        : sanctionsDeltaRecords.filter((record) => record.candidateId === candidate.id);
      const record = records.find((item) => item.id === recordId);

      if (!record) {
        throw new CorrectionPolicyError(404, "Sanctions delta record not found");
      }

      const comment = optionalComment(payload.comment).comment;
      const review = {
        candidateId: candidate.id,
        recordId: record.id,
        decision,
        actor,
        reviewedAt: new Date().toISOString(),
        ...(comment ? { comment } : {})
      };
      const savedReview = server.persistence.monitoring
        ? await server.persistence.monitoring.upsertRecordReview(review)
        : upsertMemoryRecordReview(review);

      recordAuditEvent({
        type: "RECORD_REVIEW_RECORDED",
        actor,
        candidateId: candidate.id,
        occurredAt: savedReview.reviewedAt,
        payload: {
          recordId: record.id,
          decision,
          hasComment: Boolean(comment)
        }
      });

      return { recordReview: savedReview };
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

function reviewDecisionValue(value: unknown): RecordReviewDecision {
  if (value === "good" || value === "flagged" || value === "skipped") {
    return value;
  }

  throw new CorrectionPolicyError(400, "decision must be one of good, flagged, or skipped");
}

function upsertMemoryRecordReview(review: SanctionsDeltaRecordReview) {
  const existingIndex = recordReviews.findIndex((item) => item.recordId === review.recordId);

  if (existingIndex >= 0) {
    recordReviews[existingIndex] = review;
    return review;
  }

  recordReviews.push(review);
  return review;
}

function recordMarkCompleteAuditEvent(
  candidateId: string,
  correctionAction: (typeof correctionActions)[number]
) {
  recordAuditEvent({
    type: "EXTRACTION_CORRECTION_RECORDED",
    actor: correctionAction.actor,
    candidateId,
    occurredAt: correctionAction.occurredAt,
    payload: {
      correctionActionId: correctionAction.id,
      correctionActionType: correctionAction.actionType,
      markedComplete: true,
      hasComment: Boolean(correctionAction.comment)
    }
  });
}

async function readSourceContent(
  sourceContentRepository: SourceContentRepository,
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
