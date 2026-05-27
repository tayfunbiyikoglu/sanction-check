export const candidateStatuses = [
  "DETECTED",
  "CONTENT_RETRIEVED",
  "LANGUAGE_PENDING",
  "NO_DELTA",
  "EXTRACTED_COMPLETE",
  "NEEDS_EXTRACTION_CORRECTION",
  "FAILED_RETRIEVAL",
  "FAILED_PARSING",
  "EXPORTED",
  "REEXPORT_REQUIRED"
] as const;

export type CandidateStatus = (typeof candidateStatuses)[number];

export type DeltaAction = "ADD" | "AMEND" | "REMOVE" | "REPLACE";
export type RecordType = "PERSON" | "ENTITY";

export interface CandidateLegalAct {
  id: string;
  celexId?: string;
  cellarId?: string;
  officialUri?: string;
  legalActIdentityKind?: "CELEX" | "CELLAR" | "OFFICIAL_URI";
  legalActIdentityValue?: string;
  title: string;
  publicationDate?: string;
  status: CandidateStatus;
  workingLanguage: "en";
  sourceUrl?: string;
  rssFeedName?: string;
  detectedAt: string;
  lastSeenAt: string;
  retrieval?: CandidateRetrievalState;
  sourceContent?: SourceContentReference;
}

export type RetrievalStatus =
  | "NOT_REQUESTED"
  | "CONTENT_RETRIEVED"
  | "LANGUAGE_PENDING"
  | "FAILED_RETRIEVAL";

export interface SourceContentReference {
  reference: string;
  contentHash: string;
  contentLength: number;
  contentType: "application/xml" | "text/html" | "text/plain";
  language: "en";
  sourceUri: string;
  retrievedAt: string;
}

export interface SearchResponseReference {
  reference: string;
  contentHash: string;
  contentLength: number;
  contentType: "application/xml";
  sourceUri: string;
  retrievedAt: string;
}

export interface CandidateRetrievalState {
  status: RetrievalStatus;
  attempts: number;
  lastAttemptAt?: string;
  nextRetryAt?: string;
  availableLanguages?: string[];
  sourceContentChanged?: boolean;
  previousSourceContentHash?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface SanctionsDeltaRecord {
  id: string;
  candidateId: string;
  recordType: RecordType;
  actionType: DeltaAction;
  primaryName: string;
  listedEntry?: Record<string, string | string[]>;
  affectedAnnex?: string;
  detectedBaseAct?: string;
  sourceOrder: number;
  sourceLocation?: string;
  evidenceText: string;
  confidence: number;
}

export type RecordReviewDecision = "good" | "flagged" | "skipped";

export interface SanctionsDeltaRecordReview {
  candidateId: string;
  recordId: string;
  decision: RecordReviewDecision;
  actor: string;
  reviewedAt: string;
  comment?: string;
}

export type ExtractionCorrectionActionType = "FIELD_CORRECTION" | "MISSED_RECORD_ADDITION" | "MARK_EXTRACTION_COMPLETE";

export interface ExtractionCorrectionAction {
  id: string;
  candidateId: string;
  recordId?: string;
  actionType: ExtractionCorrectionActionType;
  actor: string;
  occurredAt: string;
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
  evidenceText?: string;
  sourceLocation?: string;
  comment?: string;
}

export interface CompleteExtractionGateCheck {
  id: string;
  label: string;
  passed: boolean;
  message: string;
}

export interface CompleteExtractionGateResult {
  ready: boolean;
  blockers: string[];
  checks: CompleteExtractionGateCheck[];
}

export type CandidateClassification =
  | "DELTA"
  | "NO_DELTA"
  | "UNCERTAIN_NO_DELTA"
  | "PARSING_FAILED";

export interface ExtractionResult {
  id: string;
  candidateId: string;
  parserVersion: string;
  classification: CandidateClassification;
  confidence: number;
  annexFound: boolean;
  annexHeading?: string;
  isComplete: boolean;
  evidenceText?: string;
  createdAt: string;
}

export interface ConfiguredBaseAct {
  id: string;
  celexId: string;
  label: string;
  isActive: boolean;
  createdAt: string;
}

export interface WatchQuery {
  id: string;
  name: string;
  source: "RSS" | "EURLEX_WS";
  queryText: string;
  feedUrl?: string;
  isActive: boolean;
  createdAt: string;
  configuredBaseActIds: string[];
}

export interface MonitorRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  source: "RSS" | "EURLEX_WS";
  watchQueryId: string;
  querySnapshot: string;
  itemsSeen: number;
  newCandidates: number;
  searchResponse?: SearchResponseReference;
  errorMessage?: string;
}

export interface MonitorOverview {
  lastSuccessfulRun: string | undefined;
  candidatesToday: number;
  candidatesNeedingExtractionCorrection: number;
  completeExtractionsReadyForExport: number;
  exportBatchesCreatedToday: number;
  failedRetrievalOrParsing: number;
}
