import type { CandidateLegalAct, ExtractionResult, MonitorRun } from "@sanctions/domain";
import type { AuditEvent, AuditEventType, OperationalAlert, OperationalAlertThresholds } from "./types.js";

export const defaultOperationalAlertThresholds: OperationalAlertThresholds = {
  monitorRunStaleAfterHours: 2,
  repeatedRetrievalFailureAttempts: 3,
  languagePendingAfterHours: 24
};

const sensitivePayloadKeys = new Set([
  "address",
  "addresses",
  "alias",
  "aliases",
  "dateOfBirth",
  "datesOfBirth",
  "dob",
  "evidenceText",
  "identifier",
  "identifiers",
  "listedEntry",
  "name",
  "primaryName",
  "record",
  "sourceContent"
]);

const safeMetadataKeys = new Set(["changedFields", "fieldNames"]);

export function appendAuditEvent(input: {
  events: AuditEvent[];
  type: AuditEventType;
  occurredAt?: string;
  actor?: string;
  candidateId?: string;
  monitorRunId?: string;
  exportBatchId?: string;
  payload?: Record<string, unknown>;
}): AuditEvent {
  const event: AuditEvent = {
    id: `audit-event-${(input.events.length + 1).toString().padStart(6, "0")}`,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.candidateId ? { candidateId: input.candidateId } : {}),
    ...(input.monitorRunId ? { monitorRunId: input.monitorRunId } : {}),
    ...(input.exportBatchId ? { exportBatchId: input.exportBatchId } : {}),
    payload: sanitizeAuditPayload(input.payload ?? {})
  };

  input.events.push(event);
  return event;
}

export function sanitizeAuditPayload(payload: Record<string, unknown>): AuditEvent["payload"] {
  const sanitized: AuditEvent["payload"] = {};

  for (const [key, value] of Object.entries(payload)) {
    if (isSensitivePayloadKey(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    sanitized[key] = sanitizeAuditPayloadValue(value);
  }

  return sanitized;
}

function isSensitivePayloadKey(key: string): boolean {
  if (safeMetadataKeys.has(key)) {
    return false;
  }

  const normalized = key.toLowerCase();

  return (
    sensitivePayloadKeys.has(key) ||
    normalized.includes("address") ||
    normalized.includes("birth") ||
    normalized.includes("evidence") ||
    normalized.includes("identifier") ||
    normalized.includes("listedentry") ||
    normalized.includes("name")
  );
}

export function evaluateOperationalAlerts(input: {
  candidateLegalActs: CandidateLegalAct[];
  extractionResults: ExtractionResult[];
  monitorRuns: MonitorRun[];
  asOf?: string;
  thresholds?: Partial<OperationalAlertThresholds>;
}): OperationalAlert[] {
  const thresholds = { ...defaultOperationalAlertThresholds, ...input.thresholds };
  const detectedAt = input.asOf ?? new Date().toISOString();
  const asOfTime = Date.parse(detectedAt);
  const alerts: OperationalAlert[] = [];
  const lastSuccessfulRun = input.monitorRuns.find((run) => run.status === "SUCCESS" && run.finishedAt);

  if (
    !lastSuccessfulRun ||
    hoursBetween(Date.parse(lastSuccessfulRun.finishedAt!), asOfTime) > thresholds.monitorRunStaleAfterHours
  ) {
    alerts.push({
      id: "operational-alert-stale-monitor-run",
      type: "STALE_MONITOR_RUN",
      severity: "CRITICAL",
      message: "No successful monitor run within the operational threshold",
      detectedAt,
      ...(lastSuccessfulRun ? { monitorRunId: lastSuccessfulRun.id } : {}),
      payload: {
        thresholdHours: thresholds.monitorRunStaleAfterHours,
        lastSuccessfulRunAt: lastSuccessfulRun?.finishedAt
      }
    });
  }

  for (const candidate of input.candidateLegalActs) {
    if (
      candidate.retrieval?.status === "FAILED_RETRIEVAL" &&
      candidate.retrieval.attempts >= thresholds.repeatedRetrievalFailureAttempts
    ) {
      alerts.push({
        id: `operational-alert-retrieval-${candidate.id}`,
        type: "REPEATED_RETRIEVAL_FAILURES",
        severity: "WARNING",
        message: "Candidate Legal Act has repeated Source Content retrieval failures",
        detectedAt,
        candidateId: candidate.id,
        payload: {
          attempts: candidate.retrieval.attempts,
          thresholdAttempts: thresholds.repeatedRetrievalFailureAttempts,
          failureCode: candidate.retrieval.failureCode,
          lastAttemptAt: candidate.retrieval.lastAttemptAt
        }
      });
    }

    if (candidate.status === "FAILED_PARSING") {
      const latestParsingFailure = latestExtractionResult(input.extractionResults, candidate.id);
      alerts.push({
        id: `operational-alert-parsing-${candidate.id}`,
        type: "PARSING_FAILURE",
        severity: "WARNING",
        message: "Candidate Legal Act has a parsing failure",
        detectedAt,
        candidateId: candidate.id,
        payload: {
          parserVersion: latestParsingFailure?.parserVersion,
          classification: latestParsingFailure?.classification,
          extractionResultId: latestParsingFailure?.id
        }
      });
    }

    if (candidate.status === "LANGUAGE_PENDING" || candidate.retrieval?.status === "LANGUAGE_PENDING") {
      const pendingSince = candidate.retrieval?.lastAttemptAt ?? candidate.detectedAt;

      if (hoursBetween(Date.parse(pendingSince), asOfTime) > thresholds.languagePendingAfterHours) {
        alerts.push({
          id: `operational-alert-language-pending-${candidate.id}`,
          type: "LANGUAGE_PENDING_OVER_THRESHOLD",
          severity: "WARNING",
          message: "Language Pending Candidate exceeded the Working Language threshold",
          detectedAt,
          candidateId: candidate.id,
          payload: {
            pendingSince,
            thresholdHours: thresholds.languagePendingAfterHours,
            workingLanguage: candidate.workingLanguage
          }
        });
      }
    }
  }

  return alerts;
}

function sanitizeAuditPayloadValue(value: unknown): AuditEvent["payload"][string] {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditPayloadValue(item));
  }

  if (typeof value === "object") {
    return sanitizeAuditPayload(value as Record<string, unknown>);
  }

  return String(value);
}

function latestExtractionResult(extractionResults: ExtractionResult[], candidateId: string) {
  return extractionResults.filter((result) => result.candidateId === candidateId).at(-1);
}

function hoursBetween(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }

  return (end - start) / (60 * 60 * 1000);
}
