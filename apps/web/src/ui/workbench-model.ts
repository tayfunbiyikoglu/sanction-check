import type {
  CandidateLegalAct,
  CandidateStatus,
  CompleteExtractionGateResult,
  ExportBatch,
  ExtractionResult
} from "@sanctions/domain";

export type QueueFilter = "ALL" | CandidateStatus;
export type SourceView = "official" | "metadata";
export type LiveActionKind = "rss" | "retrieve" | "ai-extract" | null;
export type Theme = "light" | "dark";
export type ReviewDecision = "good" | "flagged" | "skipped";

export interface EvidenceJumpRequest {
  recordId: string;
  requestedAt: number;
}

export const RSS_PUBLICATION_YEAR = 2026;

export const statusOrder: CandidateStatus[] = [
  "NEEDS_EXTRACTION_CORRECTION",
  "REEXPORT_REQUIRED",
  "EXTRACTED_COMPLETE",
  "EXPORTED",
  "NO_DELTA",
  "CONTENT_RETRIEVED",
  "DETECTED",
  "LANGUAGE_PENDING",
  "FAILED_RETRIEVAL",
  "FAILED_PARSING"
];

export function groupCandidatesByStatus(candidates: CandidateLegalAct[]) {
  const orderedStatuses = [
    ...statusOrder,
    ...candidates.map((candidate) => candidate.status).filter((status) => !statusOrder.includes(status))
  ];

  return orderedStatuses.map((status) => ({
    status,
    candidates: candidates
      .filter((candidate) => candidate.status === status)
      .sort(compareCandidatesByNewestPublication)
  }));
}

export function getInitialCandidateId(candidates: CandidateLegalAct[]) {
  return (
    candidates.find((candidate) => candidate.status === "NEEDS_EXTRACTION_CORRECTION")?.id ??
    candidates.find((candidate) => candidate.status === "CONTENT_RETRIEVED")?.id ??
    candidates.find((candidate) => candidate.status === "EXTRACTED_COMPLETE")?.id ??
    candidates[0]?.id ??
    null
  );
}

export function getLatestExtractionResult(results: ExtractionResult[]) {
  return [...results].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1);
}

export function getExportReadiness({
  candidate,
  completeExtractionGate,
  extractionResult,
  exportBatches,
  reexportRequired
}: {
  candidate: CandidateLegalAct | null;
  completeExtractionGate: CompleteExtractionGateResult | null;
  extractionResult: ExtractionResult | undefined;
  exportBatches: ExportBatch[];
  reexportRequired: boolean;
}) {
  if (!candidate) {
    return {
      label: "No Candidate Legal Act",
      reason: "Select a Candidate Legal Act before creating an Export Batch.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  if (candidate.status === "NO_DELTA") {
    return {
      label: "No Delta",
      reason: "This Candidate Legal Act is classified as No Delta, so no Export Batch is required.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  if (!extractionResult) {
    return {
      label: "Extraction pending",
      reason: "A Complete Extraction result is required before an Export Batch can be evaluated.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  if (!completeExtractionGate?.ready) {
    return {
      label: "Gate blocked",
      reason: "Complete Extraction is blocked. Use Extraction Correction before creating an Export Batch.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  if (reexportRequired) {
    return {
      label: "Re-Export required",
      reason: "Current Complete Extraction differs from the latest immutable Export Batch.",
      canCreateExportBatch: true,
      requiresReexport: true
    };
  }

  if (exportBatches.length > 0 || candidate.status === "EXPORTED") {
    return {
      label: "Already exported",
      reason:
        exportBatches.length > 0
          ? "This Candidate Legal Act already has an immutable Export Batch."
          : "This Candidate Legal Act is marked as exported, so a new Export Batch is disabled unless re-export is required.",
      canCreateExportBatch: false,
      requiresReexport: false
    };
  }

  return {
    label: "Ready",
    reason: "Complete Extraction is ready for one immutable Export Batch containing all Sanctions Delta Records.",
    canCreateExportBatch: true,
    requiresReexport: false
  };
}

function compareCandidatesByNewestPublication(left: CandidateLegalAct, right: CandidateLegalAct) {
  const publicationComparison = compareOptionalDateDesc(left.publicationDate, right.publicationDate);

  if (publicationComparison !== 0) {
    return publicationComparison;
  }

  const seenComparison = compareOptionalDateDesc(left.lastSeenAt, right.lastSeenAt);

  if (seenComparison !== 0) {
    return seenComparison;
  }

  return left.title.localeCompare(right.title);
}

function compareOptionalDateDesc(left: string | undefined, right: string | undefined) {
  if (left && right) {
    return right.localeCompare(left);
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}
