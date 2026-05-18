import type {
  CandidateLegalAct,
  ConfiguredBaseAct,
  ExportBatch,
  ExportBatchRecord,
  ExportDownloadEvent,
  ExtractionCorrectionAction,
  ExtractionResult,
  MonitorOverview,
  MonitorRun,
  SanctionsDeltaRecord,
  WatchQuery
} from "@sanctions/domain";
import { resolveLegalActIdentity } from "@sanctions/domain";
import { appendAuditEvent } from "./audit/service.js";
import type { AuditEvent, AuditEventType } from "./audit/types.js";

const now = "2026-05-17T08:00:00.000Z";
export const defaultEurLexRssFeedUrl =
  "https://eur-lex.europa.eu/EN/display-feed.rss?myRssId=zqe49YNw6BwwdPmm33RRPDk44bB%2F2Iyyhz81JRn0trw%3D";

export const configuredBaseActs: ConfiguredBaseAct[] = [
  {
    id: "base-act-269-2014",
    celexId: "32014R0269",
    label: "EU restrictive measures in respect of actions undermining Ukraine",
    isActive: true,
    createdAt: "2026-05-16T14:00:00.000Z"
  }
];

export const watchQueries: WatchQuery[] = [
  {
    id: "watch-query-269-rss",
    name: "Regulation 269/2014 RSS overlap monitor",
    source: "RSS",
    queryText:
      "MS=32014R0269 OR EA=32014R0269 OR BF=32014R0269 OR RD=32014R0269 OR LB=32014R0269 ORDER BY XC DESC",
    feedUrl: defaultEurLexRssFeedUrl,
    isActive: true,
    createdAt: "2026-05-16T14:05:00.000Z",
    configuredBaseActIds: ["base-act-269-2014"]
  }
];

export const monitorRuns: MonitorRun[] = [
  {
    id: "monitor-run-001",
    startedAt: "2026-05-17T07:59:00.000Z",
    finishedAt: now,
    status: "SUCCESS",
    source: "RSS",
    watchQueryId: "watch-query-269-rss",
    querySnapshot: watchQueries[0]!.queryText,
    itemsSeen: 12,
    newCandidates: 3
  }
];

function buildSeedCandidateLegalActs(): CandidateLegalAct[] {
  return [
    {
      id: "candidate-delta-001",
      celexId: "32026R1001",
      officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R1001",
      legalActIdentityKind: "CELEX",
      legalActIdentityValue: "32026R1001",
      title: "Council Implementing Regulation sample with Annex entries",
      publicationDate: "2026-05-17",
      status: "EXTRACTED_COMPLETE",
      workingLanguage: "en",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R1001",
      rssFeedName: "Regulation 269/2014 RSS overlap monitor",
      detectedAt: "2026-05-17T08:00:00.000Z",
      lastSeenAt: "2026-05-17T08:00:00.000Z",
      retrieval: {
        status: "NOT_REQUESTED",
        attempts: 0
      }
    },
    {
      id: "candidate-correction-001",
      celexId: "32026R1002",
      officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R1002",
      legalActIdentityKind: "CELEX",
      legalActIdentityValue: "32026R1002",
      title: "Council Implementing Regulation sample needing extraction correction",
      publicationDate: "2026-05-17",
      status: "NEEDS_EXTRACTION_CORRECTION",
      workingLanguage: "en",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R1002",
      rssFeedName: "Regulation 269/2014 RSS overlap monitor",
      detectedAt: "2026-05-17T08:00:00.000Z",
      lastSeenAt: "2026-05-17T08:00:00.000Z",
      retrieval: {
        status: "NOT_REQUESTED",
        attempts: 0
      }
    },
    {
      id: "candidate-no-delta-001",
      celexId: "32026D1003",
      officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026D1003",
      legalActIdentityKind: "CELEX",
      legalActIdentityValue: "32026D1003",
      title: "Council Decision sample with no listed-entry changes",
      publicationDate: "2026-05-17",
      status: "NO_DELTA",
      workingLanguage: "en",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026D1003",
      rssFeedName: "Regulation 269/2014 RSS overlap monitor",
      detectedAt: "2026-05-17T08:00:00.000Z",
      lastSeenAt: "2026-05-17T08:00:00.000Z",
      retrieval: {
        status: "NOT_REQUESTED",
        attempts: 0
      }
    },
    {
      id: "candidate-language-pending-001",
      celexId: "32026R1004",
      officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R1004",
      legalActIdentityKind: "CELEX",
      legalActIdentityValue: "32026R1004",
      title: "Council Implementing Regulation sample awaiting English source content",
      publicationDate: "2026-05-17",
      status: "LANGUAGE_PENDING",
      workingLanguage: "en",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32026R1004",
      rssFeedName: "Regulation 269/2014 RSS overlap monitor",
      detectedAt: "2026-05-17T08:00:00.000Z",
      lastSeenAt: "2026-05-17T08:00:00.000Z",
      retrieval: {
        status: "LANGUAGE_PENDING",
        attempts: 1,
        lastAttemptAt: "2026-05-17T08:02:00.000Z",
        nextRetryAt: "2026-05-17T08:32:00.000Z",
        availableLanguages: ["fr", "de"]
      }
    },
    {
      id: "candidate-retrieval-failed-001",
      celexId: "32026R1005",
      officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R1005",
      legalActIdentityKind: "CELEX",
      legalActIdentityValue: "32026R1005",
      title: "Council Implementing Regulation sample with retrieval failure",
      publicationDate: "2026-05-17",
      status: "FAILED_RETRIEVAL",
      workingLanguage: "en",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R1005",
      rssFeedName: "Regulation 269/2014 RSS overlap monitor",
      detectedAt: "2026-05-17T08:00:00.000Z",
      lastSeenAt: "2026-05-17T08:00:00.000Z",
      retrieval: {
        status: "FAILED_RETRIEVAL",
        attempts: 2,
        lastAttemptAt: "2026-05-17T08:03:00.000Z",
        nextRetryAt: "2026-05-17T08:33:00.000Z",
        failureCode: "CELLAR_UNAVAILABLE",
        failureMessage: "CELLAR retrieval failed"
      }
    }
  ];
}

export let candidateLegalActs: CandidateLegalAct[] = buildSeedCandidateLegalActs();

export function resetCandidateLegalActsForTests() {
  candidateLegalActs = buildSeedCandidateLegalActs();
  sanctionsDeltaRecords.splice(0);
  extractionResults.splice(0);
  correctionActions.splice(0);
  exportBatches.splice(0);
  exportBatchRecords.splice(0);
  exportDownloadEvents.splice(0);
  exportBatchFiles.splice(0);
  auditEvents.splice(0);
}

export const sanctionsDeltaRecords: SanctionsDeltaRecord[] = [];
export const extractionResults: ExtractionResult[] = [];
export const correctionActions: ExtractionCorrectionAction[] = [];
export const exportBatches: ExportBatch[] = [];
export const exportBatchRecords: ExportBatchRecord[] = [];
export const exportDownloadEvents: ExportDownloadEvent[] = [];
export const exportBatchFiles: Array<{ exportBatchId: string; csv: string }> = [];
export const auditEvents: AuditEvent[] = [];

export function upsertSanctionsDeltaRecords(candidateId: string, records: SanctionsDeltaRecord[]) {
  for (let index = sanctionsDeltaRecords.length - 1; index >= 0; index -= 1) {
    if (sanctionsDeltaRecords[index]?.candidateId === candidateId) {
      sanctionsDeltaRecords.splice(index, 1);
    }
  }

  sanctionsDeltaRecords.push(...records);
}

export function upsertExtractionResult(result: ExtractionResult): ExtractionResult {
  const existingIndex = extractionResults.findIndex((item) => item.id === result.id);

  if (existingIndex >= 0) {
    extractionResults[existingIndex] = result;
    return result;
  }

  extractionResults.push(result);
  return result;
}

export function upsertCandidateLegalAct(candidate: CandidateLegalAct): CandidateLegalAct {
  const existingIndex = candidateLegalActs.findIndex((item) => item.id === candidate.id);

  if (existingIndex >= 0) {
    candidateLegalActs[existingIndex] = candidate;
    return candidate;
  }

  candidateLegalActs.push(candidate);
  return candidate;
}

export function recordMonitorRun(run: MonitorRun): MonitorRun {
  monitorRuns.unshift(run);
  return run;
}

export function recordExportBatch(batch: ExportBatch, recordLinks: ExportBatchRecord[], csv: string): ExportBatch {
  exportBatches.push(batch);
  exportBatchRecords.push(...recordLinks);
  exportBatchFiles.push({ exportBatchId: batch.id, csv });
  return batch;
}

export function recordExportDownload(event: ExportDownloadEvent): ExportDownloadEvent {
  exportDownloadEvents.push(event);
  return event;
}

export function recordAuditEvent(input: {
  type: AuditEventType;
  occurredAt?: string;
  actor?: string;
  candidateId?: string;
  monitorRunId?: string;
  exportBatchId?: string;
  payload?: Record<string, unknown>;
}): AuditEvent {
  return appendAuditEvent({
    events: auditEvents,
    ...input
  });
}

export function refreshCandidateLegalActIdentity(candidate: CandidateLegalAct): CandidateLegalAct {
  const identity = resolveLegalActIdentity(candidate);
  candidate.legalActIdentityKind = identity.kind;
  candidate.legalActIdentityValue = identity.value;
  return candidate;
}

export function getMonitorOverview(): MonitorOverview {
  return {
    lastSuccessfulRun: monitorRuns.find((run) => run.status === "SUCCESS")?.finishedAt,
    candidatesToday: candidateLegalActs.length,
    candidatesNeedingExtractionCorrection: candidateLegalActs.filter(
      (candidate) => candidate.status === "NEEDS_EXTRACTION_CORRECTION"
    ).length,
    completeExtractionsReadyForExport: candidateLegalActs.filter(
      (candidate) => candidate.status === "EXTRACTED_COMPLETE"
    ).length,
    exportBatchesCreatedToday: exportBatches.length,
    failedRetrievalOrParsing: candidateLegalActs.filter(
      (candidate) => candidate.status === "FAILED_RETRIEVAL" || candidate.status === "FAILED_PARSING"
    ).length
  };
}
