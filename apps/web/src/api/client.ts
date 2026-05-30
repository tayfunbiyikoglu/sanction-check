import type {
  CandidateLegalAct,
  CompleteExtractionGateResult,
  ConfiguredBaseAct,
  ExportBatch,
  ExportBatchRecord,
  ExportDownloadEvent,
  ExtractionCorrectionAction,
  ExtractionResult,
  MonitorOverview,
  SanctionsDeltaRecordReview,
  SanctionsDeltaRecord,
  WatchQuery
} from "@sanctions/domain";

export interface CandidateListResponse {
  candidates: CandidateLegalAct[];
}

export interface CandidateDetailResponse {
  candidate: CandidateLegalAct;
  configuredBaseActs: ConfiguredBaseAct[];
  watchQueries: WatchQuery[];
  extractionResults: ExtractionResult[];
  sanctionsDeltaRecords: SanctionsDeltaRecord[];
  recordReviews: SanctionsDeltaRecordReview[];
  correctionActions: ExtractionCorrectionAction[];
  exportBatches: ExportBatch[];
  reexportState: {
    latestExportBatchId?: string;
    reexportRequired: boolean;
  };
  completeExtractionGate: CompleteExtractionGateResult;
}

export interface MonitorOverviewResponse {
  overview: MonitorOverview;
}

export interface ConfigurationResponse {
  configuredBaseActs: ConfiguredBaseAct[];
  watchQueries: WatchQuery[];
}

export interface SourceContentResponse {
  candidateId: string;
  sourceContent: NonNullable<CandidateLegalAct["sourceContent"]>;
  content: string;
}

export interface ExportBatchListResponse {
  exportBatches: ExportBatch[];
  exportBatchRecords: ExportBatchRecord[];
  exportDownloadEvents: ExportDownloadEvent[];
}

export interface CreateExportBatchResponse {
  exportBatch: ExportBatch;
  exportBatchRecords: ExportBatchRecord[];
  csv: string;
}

export interface MarkExtractionCompleteResponse {
  candidate: CandidateLegalAct;
  extractionResult: ExtractionResult;
  correctionAction: ExtractionCorrectionAction;
  completeExtractionGate: CompleteExtractionGateResult;
}

export interface SaveRecordReviewResponse {
  recordReview: SanctionsDeltaRecordReview;
}

export interface RssRunResponse {
  monitorRun: {
    id: string;
    status: string;
    itemsSeen: number;
    newCandidates: number;
  };
  candidates: CandidateLegalAct[];
  errors: string[];
  feed: {
    url: string;
    contentLength: number;
    publicationYear: number;
    filteredOut: number;
  };
}

export interface AuditEvent {
  id: string;
  type: string;
  actor: string;
  candidateId?: string;
  monitorRunId?: string;
  exportBatchId?: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface RetrieveSourceContentResponse {
  candidate: CandidateLegalAct;
  retrieval: CandidateLegalAct["retrieval"];
  sourceContent?: CandidateLegalAct["sourceContent"];
}

export interface AiExtractionUndercountResponse {
  message: string;
  code: "AI_EXTRACTION_UNDERCOUNT";
  aiRecordCount: number;
  deterministicRecordCount: number;
  aiRecords: Array<{
    primaryName: string;
    recordType: string;
    actionType: string;
    sourceOrder: number;
    sourceLocation?: string;
  }>;
  deterministicRecords: Array<{
    primaryName: string;
    recordType: string;
    actionType: string;
    sourceOrder: number;
    sourceLocation?: string;
  }>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchCandidateLegalActs() {
  return getJson<CandidateListResponse>("/api/candidates");
}

export async function fetchMonitorOverview() {
  return getJson<MonitorOverviewResponse>("/api/monitoring/overview");
}

export async function fetchConfiguration() {
  return getJson<ConfigurationResponse>("/api/configuration");
}

export async function fetchCandidateDetail(candidateId: string) {
  return getJson<CandidateDetailResponse>(`/api/candidates/${candidateId}`);
}

export async function fetchSourceContent(candidateId: string) {
  return getJson<SourceContentResponse>(`/api/retrieval/candidates/${candidateId}/source-content`);
}

export async function fetchExportBatches() {
  return getJson<ExportBatchListResponse>("/api/export/batches");
}

export async function fetchAuditEvents() {
  return getJson<{ auditEvents: AuditEvent[] }>("/api/audit/events");
}

export async function createExportBatch(candidateId: string, reexportReason?: string) {
  const response = await fetch(`/api/export/candidates/${candidateId}/batches`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ actor: "evidence-workbench", ...(reexportReason ? { reexportReason } : {}) })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as CreateExportBatchResponse;
}

export async function markExtractionComplete(candidateId: string, comment?: string) {
  const response = await fetch(`/api/correction/candidates/${candidateId}/mark-complete`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      actor: "evidence-workbench",
      ...(comment?.trim() ? { comment: comment.trim() } : {})
    })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as MarkExtractionCompleteResponse;
}

export async function saveRecordReview(input: {
  candidateId: string;
  recordId: string;
  decision: SanctionsDeltaRecordReview["decision"];
  comment?: string;
}) {
  const response = await fetch(`/api/correction/candidates/${input.candidateId}/records/${input.recordId}/review`, {
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      actor: "evidence-workbench",
      decision: input.decision,
      ...(input.comment?.trim() ? { comment: input.comment.trim() } : {})
    })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as SaveRecordReviewResponse;
}

export async function runRssMonitor(input: { watchQueryId: string; feedUrl?: string; publicationYear?: number }) {
  const response = await fetch("/api/monitoring/rss-runs", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      watchQueryId: input.watchQueryId,
      ...(input.feedUrl ? { feedUrl: input.feedUrl } : {}),
      ...(input.publicationYear ? { publicationYear: input.publicationYear } : {})
    })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as RssRunResponse;
}

export async function createRssWatchQuery(input: { name: string; feedUrl: string }) {
  const response = await fetch("/api/configuration/watch-queries", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      actor: "evidence-workbench",
      name: input.name,
      feedUrl: input.feedUrl
    })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as { watchQuery: WatchQuery };
}

export async function retrieveSourceContent(candidateId: string, mode: "mock" | "live" = "live") {
  const response = await fetch(`/api/retrieval/candidates/${candidateId}/retrieve-source-content`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      mode,
      ...(mode === "live" ? { endpointUrl: "https://publications.europa.eu/resource/" } : {})
    })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as RetrieveSourceContentResponse;
}

export async function classifySourceContent(candidateId: string) {
  const response = await fetch(`/api/classification/candidates/${candidateId}/classify-source-content`, {
    method: "POST"
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as unknown;
}

export async function aiExtractSourceContent(candidateId: string) {
  const response = await fetch(`/api/classification/candidates/${candidateId}/ai-extract-source-content`, {
    method: "POST"
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new ApiRequestError(body?.message ?? `Request failed: ${response.status}`, response.status, body);
  }

  return (await response.json()) as unknown;
}
