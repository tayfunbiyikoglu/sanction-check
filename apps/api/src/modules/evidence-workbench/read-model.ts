import type {
  CandidateLegalAct,
  CompleteExtractionGateResult,
  ConfiguredBaseAct,
  ExportBatch,
  ExtractionCorrectionAction,
  ExtractionResult,
  MonitorOverview,
  MonitorRun,
  SanctionsDeltaRecord,
  SanctionsDeltaRecordReview,
  WatchQuery
} from "@sanctions/domain";
import { evaluateOperationalAlerts } from "../audit/service.js";
import type { AuditEvent } from "../audit/types.js";
import { evaluateCompleteExtractionGate } from "../correction/complete-extraction-gate.js";
import { evaluateReexportState, type ReexportState } from "../export/service.js";

export interface EvidenceWorkbenchOverview {
  overview: MonitorOverview;
  operationalAlerts: ReturnType<typeof evaluateOperationalAlerts>;
}

export interface CandidateLegalActWorkbenchDetail {
  candidate: CandidateLegalAct;
  configuredBaseActs: ConfiguredBaseAct[];
  watchQueries: WatchQuery[];
  extractionResults: ExtractionResult[];
  sanctionsDeltaRecords: SanctionsDeltaRecord[];
  recordReviews: SanctionsDeltaRecordReview[];
  correctionActions: ExtractionCorrectionAction[];
  exportBatches: ExportBatch[];
  reexportState: ReexportState;
  completeExtractionGate: CompleteExtractionGateResult;
}

export function buildEvidenceWorkbenchOverview(input: {
  candidateLegalActs: CandidateLegalAct[];
  exportBatches: ExportBatch[];
  extractionResults: ExtractionResult[];
  monitorRuns: MonitorRun[];
  now?: string;
}): EvidenceWorkbenchOverview {
  return {
    overview: {
      lastSuccessfulRun: input.monitorRuns.find((run) => run.status === "SUCCESS")?.finishedAt,
      candidatesToday: input.candidateLegalActs.length,
      candidatesNeedingExtractionCorrection: input.candidateLegalActs.filter(
        (candidate) => candidate.status === "NEEDS_EXTRACTION_CORRECTION"
      ).length,
      completeExtractionsReadyForExport: input.candidateLegalActs.filter(
        (candidate) => candidate.status === "EXTRACTED_COMPLETE"
      ).length,
      exportBatchesCreatedToday: countExportBatchesCreatedToday(input.exportBatches, input.now),
      failedRetrievalOrParsing: input.candidateLegalActs.filter(
        (candidate) => candidate.status === "FAILED_RETRIEVAL" || candidate.status === "FAILED_PARSING"
      ).length
    },
    operationalAlerts: evaluateOperationalAlerts({
      candidateLegalActs: input.candidateLegalActs,
      extractionResults: input.extractionResults,
      monitorRuns: input.monitorRuns
    })
  };
}

export function buildCandidateLegalActWorkbenchDetail(input: {
  candidate: CandidateLegalAct;
  configuredBaseActs: ConfiguredBaseAct[];
  correctionActions: ExtractionCorrectionAction[];
  exportBatches: ExportBatch[];
  extractionResults: ExtractionResult[];
  sanctionsDeltaRecords: SanctionsDeltaRecord[];
  recordReviews?: SanctionsDeltaRecordReview[];
  watchQueries: WatchQuery[];
}): CandidateLegalActWorkbenchDetail {
  const candidateExportBatches = input.exportBatches.filter((batch) => batch.candidateId === input.candidate.id);
  const candidateCorrectionActions = input.correctionActions.filter((action) => action.candidateId === input.candidate.id);
  const latestExtractionResult = input.extractionResults.at(-1);

  return {
    candidate: input.candidate,
    configuredBaseActs: input.configuredBaseActs,
    watchQueries: input.watchQueries,
    extractionResults: input.extractionResults,
    sanctionsDeltaRecords: input.sanctionsDeltaRecords,
    recordReviews: input.recordReviews ?? [],
    correctionActions: candidateCorrectionActions,
    exportBatches: candidateExportBatches,
    reexportState: evaluateReexportState({
      candidate: input.candidate,
      ...(latestExtractionResult ? { extractionResult: latestExtractionResult } : {}),
      records: input.sanctionsDeltaRecords,
      existingBatches: input.exportBatches
    }),
    completeExtractionGate: evaluateCompleteExtractionGate({
      candidate: input.candidate,
      ...(latestExtractionResult ? { extractionResult: latestExtractionResult } : {}),
      records: input.sanctionsDeltaRecords
    })
  };
}

function countExportBatchesCreatedToday(exportBatches: ExportBatch[], now = new Date().toISOString()): number {
  const today = now.slice(0, 10);
  return exportBatches.filter((batch) => batch.createdAt.slice(0, 10) === today).length;
}
