export type AuditEventType =
  | "MONITOR_RUN_RECORDED"
  | "RETRIEVAL_ATTEMPT_RECORDED"
  | "PARSING_FAILURE_RECORDED"
  | "EXTRACTION_CORRECTION_RECORDED"
  | "RECORD_REVIEW_RECORDED"
  | "EXPORT_BATCH_CREATED"
  | "EXPORT_BATCH_DOWNLOADED"
  | "CANDIDATE_REPROCESSED"
  | "CONFIGURATION_CHANGED"
  | "AUDIT_EVENT_RECORDED";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  occurredAt: string;
  actor?: string;
  candidateId?: string;
  monitorRunId?: string;
  exportBatchId?: string;
  payload: Record<string, AuditPayloadValue>;
}

export type AuditPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | AuditPayloadValue[]
  | { [key: string]: AuditPayloadValue };

export type OperationalAlertType =
  | "STALE_MONITOR_RUN"
  | "REPEATED_RETRIEVAL_FAILURES"
  | "PARSING_FAILURE"
  | "LANGUAGE_PENDING_OVER_THRESHOLD";

export interface OperationalAlert {
  id: string;
  type: OperationalAlertType;
  severity: "WARNING" | "CRITICAL";
  message: string;
  detectedAt: string;
  candidateId?: string;
  monitorRunId?: string;
  payload: Record<string, string | number | boolean | undefined>;
}

export interface OperationalAlertThresholds {
  monitorRunStaleAfterHours: number;
  repeatedRetrievalFailureAttempts: number;
  languagePendingAfterHours: number;
}
