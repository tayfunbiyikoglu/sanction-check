import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../app.js";
import { exportBatches, extractionResults, resetCandidateLegalActsForTests } from "../seed-data.js";

describe("classification routes", () => {
  let sourceContentRoot: string | undefined;

  beforeEach(async () => {
    resetCandidateLegalActsForTests();
    sourceContentRoot = await mkdtemp(path.join(tmpdir(), "classification-source-content-"));
    process.env.SOURCE_CONTENT_STORAGE_DIR = sourceContentRoot;
  });

  afterEach(async () => {
    delete process.env.SOURCE_CONTENT_STORAGE_DIR;
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    if (sourceContentRoot) {
      await rm(sourceContentRoot, { recursive: true, force: true });
    }
  });

  it("classifies a retrieved delta candidate and stores an extraction result", async () => {
    const server = buildServer();
    await server.inject({
      method: "POST",
      url: "/retrieval/candidates/candidate-delta-001/retrieve-source-content"
    });

    const classifyResponse = await server.inject({
      method: "POST",
      url: "/classification/candidates/candidate-delta-001/classify-source-content"
    });

    expect(classifyResponse.statusCode).toBe(200);
    expect(classifyResponse.json()).toMatchObject({
      candidate: {
        id: "candidate-delta-001",
        status: "EXTRACTED_COMPLETE"
      },
      extractionResult: {
        classification: "DELTA",
        annexFound: true,
        isComplete: true
      }
    });
  });

  it("classifies a retrieved no-delta candidate automatically", async () => {
    const server = buildServer();
    await server.inject({
      method: "POST",
      url: "/retrieval/candidates/candidate-no-delta-001/retrieve-source-content"
    });

    const classifyResponse = await server.inject({
      method: "POST",
      url: "/classification/candidates/candidate-no-delta-001/classify-source-content"
    });

    expect(classifyResponse.statusCode).toBe(200);
    expect(classifyResponse.json()).toMatchObject({
      candidate: {
        id: "candidate-no-delta-001",
        status: "NO_DELTA"
      },
      extractionResult: {
        classification: "NO_DELTA",
        annexFound: false,
        isComplete: true
      }
    });
  });

  it("requires official English source content before classification", async () => {
    const server = buildServer();
    const classifyResponse = await server.inject({
      method: "POST",
      url: "/classification/candidates/candidate-correction-001/classify-source-content"
    });

    expect(classifyResponse.statusCode).toBe(409);
  });

  it("explicitly reprocesses a candidate while preserving historical extraction and export artifacts", async () => {
    const server = buildServer();
    await server.inject({
      method: "POST",
      url: "/retrieval/candidates/candidate-delta-001/retrieve-source-content"
    });
    await server.inject({
      method: "POST",
      url: "/classification/candidates/candidate-delta-001/classify-source-content"
    });
    const exportResponse = await server.inject({
      method: "POST",
      url: "/export/candidates/candidate-delta-001/batches",
      payload: { actor: "audit-owner" }
    });

    const reprocessResponse = await server.inject({
      method: "POST",
      url: "/classification/candidates/candidate-delta-001/reprocess-source-content"
    });

    expect(exportResponse.statusCode).toBe(201);
    expect(reprocessResponse.statusCode).toBe(200);
    expect(reprocessResponse.json()).toMatchObject({
      reprocessed: true,
      candidate: {
        id: "candidate-delta-001",
        status: "EXPORTED"
      },
      extractionResult: {
        parserVersion: "deterministic-annex-parser-v1",
        isComplete: true
      },
      reexportState: {
        latestExportBatchId: exportResponse.json().exportBatch.id,
        reexportRequired: false
      }
    });
    expect(extractionResults).toHaveLength(2);
    expect(exportBatches).toHaveLength(1);
  });

  it("rejects complete AI extraction when deterministic Annex extraction finds more records", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            classification: "DELTA",
            confidence: 0.9,
            annexFound: true,
            annexHeading: "Annex I",
            isComplete: true,
            evidenceSummary: "One incomplete AI record.",
            records: [
              {
                recordType: "PERSON",
                actionType: "ADD",
                primaryName: "Jane Example",
                listedEntryFields: [{ field: "name", value: "Jane Example" }],
                affectedAnnex: "Annex I",
                detectedBaseAct: "32014R0269",
                sourceLocation: "Annex I; row 1",
                evidenceText: "Jane Example; date of birth: 12 March 1975.",
                confidence: 0.9
              }
            ]
          })
        })
      }))
    );
    const server = buildServer();
    await server.inject({
      method: "POST",
      url: "/retrieval/candidates/candidate-delta-001/retrieve-source-content"
    });

    const response = await server.inject({
      method: "POST",
      url: "/classification/candidates/candidate-delta-001/ai-extract-source-content"
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "AI_EXTRACTION_UNDERCOUNT",
      message:
        "AI extraction returned 1 complete records, but deterministic Annex extraction found 2. Use deterministic extraction or review the AI provider output before export.",
      aiRecordCount: 1,
      deterministicRecordCount: 2,
      aiRecords: [
        {
          primaryName: "Jane Example"
        }
      ],
      deterministicRecords: [
        {
          primaryName: "Jane Example"
        },
        {
          primaryName: "Example Entity Ltd"
        }
      ]
    });
    expect(extractionResults).toHaveLength(0);
  });
});
