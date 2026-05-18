import { createHash } from "node:crypto";
import type { CandidateLegalAct, ExtractionResult, SanctionsDeltaRecord } from "@sanctions/domain";
import { describe, expect, it } from "vitest";
import { createExportBatch, evaluateReexportState, hashExtractionSnapshot, serializeAuditCsv } from "./service.js";

describe("export batch service", () => {
  it("serializes audit CSV rows by deterministic source order and hashes the immutable file bytes", () => {
    const records = [record({ id: "record-2", sourceOrder: 2 }), record({ id: "record-1", sourceOrder: 1 })];
    const result = createExportBatch({
      candidate: candidate(),
      extractionResult: extraction(),
      records,
      completeExtractionGate: { ready: true, blockers: [] },
      existingBatches: [],
      actor: "export-user",
      createdAt: "2026-05-17T08:30:00.000Z",
      batchId: "export-batch-001"
    });

    const lines = result.csv.trim().split("\n");

    expect(lines[0]).toContain("export_batch_id,candidate_id,legal_act_identity_kind");
    expect(lines[1]).toContain("record-1");
    expect(lines[2]).toContain("record-2");
    expect(result.batch).toMatchObject({
      id: "export-batch-001",
      candidateId: "candidate-1",
      status: "CREATED",
      createdBy: "export-user",
      fileName: "32026r1001-export-20260517083000.csv",
      recordCount: 2,
      fileHash: createHash("sha256").update(result.csv, "utf8").digest("hex")
    });
    expect(result.recordLinks).toEqual([
      { exportBatchId: "export-batch-001", recordId: "record-1" },
      { exportBatchId: "export-batch-001", recordId: "record-2" }
    ]);
  });

  it("keeps the extraction snapshot hash stable for equivalent export-relevant content", () => {
    const firstHash = hashExtractionSnapshot({
      candidate: candidate(),
      extractionResult: extraction({ createdAt: "2026-05-17T08:30:00.000Z" }),
      records: [record({ id: "record-2", sourceOrder: 2 }), record({ id: "record-1", sourceOrder: 1 })]
    });
    const secondHash = hashExtractionSnapshot({
      candidate: candidate({ detectedAt: "2026-05-18T09:00:00.000Z" }),
      extractionResult: extraction({ createdAt: "2026-05-18T09:30:00.000Z" }),
      records: [record({ id: "record-1", sourceOrder: 1 }), record({ id: "record-2", sourceOrder: 2 })]
    });
    const changedHash = hashExtractionSnapshot({
      candidate: candidate(),
      extractionResult: extraction(),
      records: [record({ id: "record-1", sourceOrder: 1, evidenceText: "Changed source evidence" })]
    });

    expect(firstHash).toBe(secondHash);
    expect(changedHash).not.toBe(firstHash);
  });

  it("includes audit-friendly source metadata, listed entry JSON, and evidence text", () => {
    const csv = serializeAuditCsv({
      batch: { id: "export-batch-001" },
      candidate: candidate(),
      extractionResult: extraction(),
      records: [record({ id: "record-1", sourceOrder: 1 })]
    });

    expect(csv).toContain("source_content_hash");
    expect(csv).toContain("cellar:mock:32026R1001/en/xml");
    expect(csv).toContain('"{""dateofbirth"":""12 March 1975"",""name"":""Jane Example""}"');
    expect(csv).toContain("Jane Example; date of birth: 12 March 1975.");
  });

  it("compares current complete extraction snapshots to the latest export batch", () => {
    const exported = createExportBatch({
      candidate: candidate(),
      extractionResult: extraction(),
      records: [record({ id: "record-1", sourceOrder: 1 })],
      completeExtractionGate: { ready: true, blockers: [] },
      existingBatches: [],
      actor: "export-user",
      createdAt: "2026-05-17T08:30:00.000Z",
      batchId: "export-batch-001"
    });

    const unchanged = evaluateReexportState({
      candidate: candidate(),
      extractionResult: extraction(),
      records: [record({ id: "record-1", sourceOrder: 1 })],
      existingBatches: [exported.batch]
    });
    const changed = evaluateReexportState({
      candidate: candidate(),
      extractionResult: extraction({ parserVersion: "deterministic-annex-parser-v2" }),
      records: [record({ id: "record-1", sourceOrder: 1 })],
      existingBatches: [exported.batch]
    });

    expect(unchanged).toMatchObject({
      latestExportBatchId: "export-batch-001",
      reexportRequired: false
    });
    expect(changed).toMatchObject({
      latestExportBatchId: "export-batch-001",
      reexportRequired: true
    });
  });
});

function candidate(overrides: Partial<CandidateLegalAct> = {}): CandidateLegalAct {
  return {
    id: "candidate-1",
    celexId: "32026R1001",
    officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R1001",
    legalActIdentityKind: "CELEX",
    legalActIdentityValue: "32026R1001",
    title: "Council Implementing Regulation sample with Annex entries",
    publicationDate: "2026-05-17",
    status: "EXTRACTED_COMPLETE",
    workingLanguage: "en",
    detectedAt: "2026-05-17T08:00:00.000Z",
    lastSeenAt: "2026-05-17T08:00:00.000Z",
    sourceContent: {
      reference: "sha256/aa/source.xml",
      contentHash: "source-hash",
      contentLength: 100,
      contentType: "application/xml",
      language: "en",
      sourceUri: "cellar:mock:32026R1001/en/xml",
      retrievedAt: "2026-05-17T08:05:00.000Z"
    },
    ...overrides
  };
}

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    id: "extraction-1",
    candidateId: "candidate-1",
    parserVersion: "deterministic-annex-parser-v1",
    classification: "DELTA",
    confidence: 0.99,
    annexFound: true,
    annexHeading: "Annex I",
    isComplete: true,
    createdAt: "2026-05-17T08:10:00.000Z",
    ...overrides
  };
}

function record(overrides: Partial<SanctionsDeltaRecord>): SanctionsDeltaRecord {
  return {
    id: "record-1",
    candidateId: "candidate-1",
    recordType: "PERSON",
    actionType: "ADD",
    primaryName: "Jane Example",
    listedEntry: {
      name: "Jane Example",
      dateofbirth: "12 March 1975"
    },
    affectedAnnex: "Annex I",
    detectedBaseAct: "32014R0269",
    sourceOrder: 1,
    sourceLocation: "Annex I; section 1; row 1",
    evidenceText: "Jane Example; date of birth: 12 March 1975.",
    confidence: 0.99,
    ...overrides
  };
}
