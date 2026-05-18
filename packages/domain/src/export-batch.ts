export interface ExportBatch {
  id: string;
  candidateId: string;
  createdAt: string;
  createdBy: string;
  status: "CREATED";
  fileName: string;
  fileHash: string;
  extractionSnapshotHash: string;
  recordCount: number;
  reexportOfBatchId?: string;
  reexportReason?: string;
}

export interface ExportBatchRecord {
  exportBatchId: string;
  recordId: string;
}

export interface ExportDownloadEvent {
  id: string;
  exportBatchId: string;
  downloadedAt: string;
  downloadedBy: string;
}

export interface ExportableRecordSnapshot {
  id: string;
  recordType: "PERSON" | "ENTITY";
  actionType: "ADD" | "AMEND" | "REMOVE" | "REPLACE";
  primaryName: string;
  listedEntry?: Record<string, string | string[]>;
  affectedAnnex?: string;
  detectedBaseAct?: string;
  sourceOrder: number;
  sourceLocation?: string;
  evidenceText: string;
  confidence: number;
}
