import type { CandidateLegalAct, ExportBatch, ExtractionResult } from "@sanctions/domain";
import { describe, expect, it } from "vitest";
import { getExportReadiness, groupCandidatesByStatus } from "./App.js";

const baseCandidate: CandidateLegalAct = {
  id: "candidate-001",
  celexId: "32026R1001",
  legalActIdentityKind: "CELEX",
  legalActIdentityValue: "32026R1001",
  title: "Council Implementing Regulation sample",
  publicationDate: "2026-05-17",
  status: "EXTRACTED_COMPLETE",
  workingLanguage: "en",
  detectedAt: "2026-05-17T08:00:00.000Z",
  lastSeenAt: "2026-05-17T08:00:00.000Z"
};

const extractionResult: ExtractionResult = {
  id: "extraction-001",
  candidateId: "candidate-001",
  parserVersion: "parser-2026.05",
  classification: "DELTA",
  confidence: 0.94,
  annexFound: true,
  annexHeading: "Annex I",
  isComplete: true,
  createdAt: "2026-05-17T08:05:00.000Z"
};

const exportBatch: ExportBatch = {
  id: "export-batch-001",
  candidateId: "candidate-001",
  createdAt: "2026-05-17T08:10:00.000Z",
  createdBy: "test",
  status: "CREATED",
  fileName: "32026r1001-export.csv",
  fileHash: "abc123",
  extractionSnapshotHash: "snapshot123",
  recordCount: 2
};

describe("Evidence Workbench workflow helpers", () => {
  it("groups Candidate Legal Acts by operational processing status", () => {
    const groups = groupCandidatesByStatus([
      { ...baseCandidate, id: "ready", status: "EXTRACTED_COMPLETE" },
      { ...baseCandidate, id: "correction", status: "NEEDS_EXTRACTION_CORRECTION" },
      { ...baseCandidate, id: "no-delta", status: "NO_DELTA" }
    ]);

    expect(groups.find((group) => group.status === "NEEDS_EXTRACTION_CORRECTION")?.candidates).toHaveLength(1);
    expect(groups.find((group) => group.status === "EXTRACTED_COMPLETE")?.candidates).toHaveLength(1);
    expect(groups.find((group) => group.status === "NO_DELTA")?.candidates).toHaveLength(1);
  });

  it("orders Candidate Legal Acts by newest publication date inside each status", () => {
    const groups = groupCandidatesByStatus([
      { ...baseCandidate, id: "older", celexId: "32026R0001", publicationDate: "2026-01-10" },
      { ...baseCandidate, id: "newer", celexId: "32026R0002", publicationDate: "2026-05-18" },
      { ...baseCandidate, id: "middle", celexId: "32026R0003", publicationDate: "2026-03-12" }
    ]);

    expect(groups.find((group) => group.status === "EXTRACTED_COMPLETE")?.candidates.map((candidate) => candidate.id)).toEqual([
      "newer",
      "middle",
      "older"
    ]);
  });

  it("allows one Export Batch only when Complete Extraction is ready", () => {
    const readiness = getExportReadiness({
      candidate: baseCandidate,
      completeExtractionGate: { ready: true, blockers: [], checks: [] },
      extractionResult,
      exportBatches: [],
      reexportRequired: false
    });

    expect(readiness.canCreateExportBatch).toBe(true);
    expect(readiness.requiresReexport).toBe(false);
    expect(readiness.reason).toContain("all Sanctions Delta Records");
  });

  it("blocks Export Batch creation for No Delta Candidate Legal Acts", () => {
    const readiness = getExportReadiness({
      candidate: { ...baseCandidate, status: "NO_DELTA" },
      completeExtractionGate: { ready: true, blockers: [], checks: [] },
      extractionResult: { ...extractionResult, classification: "NO_DELTA" },
      exportBatches: [],
      reexportRequired: false
    });

    expect(readiness.canCreateExportBatch).toBe(false);
    expect(readiness.label).toBe("No Delta");
  });

  it("keeps existing immutable Export Batches visible without a new batch action", () => {
    const readiness = getExportReadiness({
      candidate: { ...baseCandidate, status: "EXPORTED" },
      completeExtractionGate: { ready: true, blockers: [], checks: [] },
      extractionResult,
      exportBatches: [exportBatch],
      reexportRequired: false
    });

    expect(readiness.canCreateExportBatch).toBe(false);
    expect(readiness.label).toBe("Already exported");
  });

  it("surfaces Re-Export only after the current Complete Extraction differs", () => {
    const readiness = getExportReadiness({
      candidate: { ...baseCandidate, status: "REEXPORT_REQUIRED" },
      completeExtractionGate: { ready: true, blockers: [], checks: [] },
      extractionResult,
      exportBatches: [exportBatch],
      reexportRequired: true
    });

    expect(readiness.canCreateExportBatch).toBe(true);
    expect(readiness.requiresReexport).toBe(true);
  });
});
