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
    throw new Error(body?.message ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as unknown;
}
