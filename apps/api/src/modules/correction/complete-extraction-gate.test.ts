import type { CandidateLegalAct, ExtractionResult, SanctionsDeltaRecord } from "@sanctions/domain";
import { describe, expect, it } from "vitest";
import { evaluateCompleteExtractionGate } from "./complete-extraction-gate.js";

describe("evaluateCompleteExtractionGate", () => {
  it("marks a no-delta candidate ready when classification is complete", () => {
    expect(
      evaluateCompleteExtractionGate({
        candidate: candidate({ status: "NO_DELTA" }),
        extractionResult: extraction({ classification: "NO_DELTA", isComplete: true, annexFound: false }),
        records: []
      })
    ).toMatchObject({ ready: true, blockers: [] });
  });

  it("marks a delta candidate ready when records and parser validation are clean", () => {
    expect(
      evaluateCompleteExtractionGate({
        candidate: candidate({ status: "EXTRACTED_COMPLETE", withSource: true }),
        extractionResult: extraction({ classification: "DELTA", annexFound: true, isComplete: true }),
        records: [record()]
      })
    ).toMatchObject({ ready: true, blockers: [] });
  });

  it("shows the unconfirmed complete-extraction check as a blocker", () => {
    const result = evaluateCompleteExtractionGate({
      candidate: candidate({ status: "NEEDS_EXTRACTION_CORRECTION", withSource: true }),
      extractionResult: extraction({ classification: "DELTA", annexFound: true, isComplete: false }),
      records: [record()]
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Parser did not mark the latest extraction complete");
    expect(result.checks).toContainEqual({
      id: "complete-extraction-confirmed",
      label: "Extractor completeness signal",
      passed: false,
      message: "Parser did not mark the latest extraction complete"
    });
  });

  it("explains when an AI extraction requires human coverage review", () => {
    const result = evaluateCompleteExtractionGate({
      candidate: candidate({ status: "NEEDS_EXTRACTION_CORRECTION", withSource: true }),
      extractionResult: extraction({
        classification: "DELTA",
        annexFound: true,
        isComplete: false,
        parserVersion: "openai-structured-extractor-v1"
      }),
      records: [record()]
    });

    expect(result.blockers).toContain(
      "AI extractor returned incomplete; review official Annex coverage before marking complete"
    );
  });

  it("blocks missing source content, missing classification, parser issues, and missing records", () => {
    const result = evaluateCompleteExtractionGate({
      candidate: candidate({ status: "CONTENT_RETRIEVED" }),
      records: [],
      validationIssues: [{ code: "COUNT_MISMATCH", message: "Annex expected 2 records but 1 was extracted" }]
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      "Official English source content has not been retrieved",
      "Candidate legal act has not been classified",
      "COUNT_MISMATCH: Annex expected 2 records but 1 was extracted"
    ]);
  });

  it("blocks language pending and retrieval failure states", () => {
    expect(
      evaluateCompleteExtractionGate({
        candidate: candidate({ status: "LANGUAGE_PENDING" }),
        records: []
      }).blockers
    ).toContain("Official English source content is not available yet");

    expect(
      evaluateCompleteExtractionGate({
        candidate: candidate({ status: "FAILED_RETRIEVAL" }),
        records: []
      }).blockers
    ).toContain("Official source content retrieval failed");
  });

  it("blocks extracted records missing required export evidence", () => {
    const result = evaluateCompleteExtractionGate({
      candidate: candidate({ status: "NEEDS_EXTRACTION_CORRECTION", withSource: true }),
      extractionResult: extraction({ classification: "DELTA", annexFound: true }),
      records: [withoutSourceLocation({ ...record(), evidenceText: "" })]
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Record record-1 is missing Evidence Text");
    expect(result.blockers).toContain("Record record-1 is missing source location");
  });
});

function candidate({
  status,
  withSource = false
}: {
  status: CandidateLegalAct["status"];
  withSource?: boolean;
}): CandidateLegalAct {
  return {
    id: "candidate-1",
    celexId: "32026R1001",
    title: "Candidate Legal Act",
    status,
    workingLanguage: "en",
    detectedAt: "2026-05-17T08:00:00.000Z",
    lastSeenAt: "2026-05-17T08:00:00.000Z",
    ...(withSource
      ? {
          sourceContent: {
            reference: "sha256/ab/hash.xml",
            contentHash: "hash",
            contentLength: 100,
            contentType: "application/xml" as const,
            language: "en" as const,
            sourceUri: "cellar:mock",
            retrievedAt: "2026-05-17T08:00:00.000Z"
          }
        }
      : {})
  };
}

function withoutSourceLocation(record: SanctionsDeltaRecord): SanctionsDeltaRecord {
  const { sourceLocation: _sourceLocation, ...withoutLocation } = record;
  return withoutLocation;
}

function extraction(overrides: Partial<ExtractionResult>): ExtractionResult {
  return {
    id: "extraction-1",
    candidateId: "candidate-1",
    parserVersion: "test",
    classification: "DELTA",
    confidence: 0.9,
    annexFound: true,
    isComplete: false,
    createdAt: "2026-05-17T08:00:00.000Z",
    ...overrides
  };
}

function record(): SanctionsDeltaRecord {
  return {
    id: "record-1",
    candidateId: "candidate-1",
    recordType: "PERSON",
    actionType: "ADD",
    primaryName: "Jane Example",
    sourceOrder: 1,
    sourceLocation: "Annex I; section 1; row 1",
    evidenceText: "Jane Example",
    confidence: 0.99
  };
}
