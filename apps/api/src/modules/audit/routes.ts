import type { FastifyInstance } from "fastify";
import {
  auditEvents,
  candidateLegalActs,
  extractionResults,
  monitorRuns,
  recordAuditEvent
} from "../seed-data.js";
import { defaultOperationalAlertThresholds, evaluateOperationalAlerts } from "./service.js";
import type { AuditEventType, OperationalAlertThresholds } from "./types.js";

const auditEventTypes = new Set<AuditEventType>([
  "MONITOR_RUN_RECORDED",
  "RETRIEVAL_ATTEMPT_RECORDED",
  "PARSING_FAILURE_RECORDED",
  "EXTRACTION_CORRECTION_RECORDED",
  "EXPORT_BATCH_CREATED",
  "EXPORT_BATCH_DOWNLOADED",
  "CANDIDATE_REPROCESSED",
  "CONFIGURATION_CHANGED",
  "AUDIT_EVENT_RECORDED"
]);

export async function registerAuditRoutes(server: FastifyInstance) {
  server.get("/events", async (request) => {
    const query = request.query as {
      candidateId?: string;
      exportBatchId?: string;
      monitorRunId?: string;
      type?: AuditEventType;
    };

    return {
      auditEvents: auditEvents.filter((event) => {
        if (query.candidateId && event.candidateId !== query.candidateId) {
          return false;
        }

        if (query.exportBatchId && event.exportBatchId !== query.exportBatchId) {
          return false;
        }

        if (query.monitorRunId && event.monitorRunId !== query.monitorRunId) {
          return false;
        }

        return !(query.type && event.type !== query.type);
      })
    };
  });

  server.post("/events", async (request, reply) => {
    const body = (request.body ?? {}) as {
      type?: unknown;
      actor?: unknown;
      candidateId?: unknown;
      monitorRunId?: unknown;
      exportBatchId?: unknown;
      occurredAt?: unknown;
      payload?: unknown;
    };

    if (typeof body.type !== "string" || !auditEventTypes.has(body.type as AuditEventType)) {
      return reply.code(400).send({ message: "Known audit event type is required" });
    }

    if (body.payload !== undefined && (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload))) {
      return reply.code(400).send({ message: "payload must be an object" });
    }

    const event = recordAuditEvent({
      type: body.type as AuditEventType,
      ...(typeof body.actor === "string" ? { actor: body.actor } : {}),
      ...(typeof body.candidateId === "string" ? { candidateId: body.candidateId } : {}),
      ...(typeof body.monitorRunId === "string" ? { monitorRunId: body.monitorRunId } : {}),
      ...(typeof body.exportBatchId === "string" ? { exportBatchId: body.exportBatchId } : {}),
      ...(typeof body.occurredAt === "string" ? { occurredAt: body.occurredAt } : {}),
      payload: (body.payload ?? {}) as Record<string, unknown>
    });

    return reply.code(201).send({ auditEvent: event });
  });

  server.get("/alerts", async (request) => {
    const query = request.query as {
      asOf?: string;
      monitorRunStaleAfterHours?: string;
      repeatedRetrievalFailureAttempts?: string;
      languagePendingAfterHours?: string;
    };

    const thresholds = parseThresholds(query);

    return {
      thresholds: { ...defaultOperationalAlertThresholds, ...thresholds },
      operationalAlerts: evaluateOperationalAlerts({
        candidateLegalActs,
        extractionResults,
        monitorRuns,
        ...(query.asOf ? { asOf: query.asOf } : {}),
        thresholds
      })
    };
  });
}

function parseThresholds(query: Record<string, string | undefined>): Partial<OperationalAlertThresholds> {
  return {
    ...optionalPositiveNumber(query.monitorRunStaleAfterHours, "monitorRunStaleAfterHours"),
    ...optionalPositiveNumber(query.repeatedRetrievalFailureAttempts, "repeatedRetrievalFailureAttempts"),
    ...optionalPositiveNumber(query.languagePendingAfterHours, "languagePendingAfterHours")
  };
}

function optionalPositiveNumber<K extends keyof OperationalAlertThresholds>(
  value: string | undefined,
  key: K
): Partial<OperationalAlertThresholds> {
  if (value === undefined) {
    return {};
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? { [key]: parsed } : {};
}
