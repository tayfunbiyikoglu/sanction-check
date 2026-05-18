import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../app.js";
import {
  auditEvents,
  exportBatches,
  extractionResults,
  resetCandidateLegalActsForTests
} from "../seed-data.js";

describe("Evidence Workbench behavior harness", () => {
  let sourceContentRoot: string | undefined;

  beforeEach(async () => {
    resetCandidateLegalActsForTests();
    sourceContentRoot = await mkdtemp(path.join(tmpdir(), "workbench-source-content-"));
    process.env.SOURCE_CONTENT_STORAGE_DIR = sourceContentRoot;
  });

  afterEach(async () => {
    delete process.env.SOURCE_CONTENT_STORAGE_DIR;
    if (sourceContentRoot) {
      await rm(sourceContentRoot, { recursive: true, force: true });
    }
  });

  it("runs the Candidate Legal Act happy path with immutable export and safe audit visibility", async () => {
    const server = buildServer();

    const retrieval = await server.inject({
      method: "POST",
      url: "/retrieval/candidates/candidate-delta-001/retrieve-source-content"
    });
    expect(retrieval.statusCode).toBe(200);
    expect(retrieval.json()).toMatchObject({
      candidate: {
        status: "CONTENT_RETRIEVED",
        sourceContent: {
          contentType: "application/xml",
          language: "en"
        }
      }
    });

    const classification = await server.inject({
      method: "POST",
      url: "/classification/candidates/candidate-delta-001/classify-source-content"
    });
    expect(classification.statusCode).toBe(200);
    expect(classification.json()).toMatchObject({
      candidate: {
        status: "EXTRACTED_COMPLETE"
      },
      extractionResult: {
        classification: "DELTA",
        parserVersion: "deterministic-annex-parser-v1",
        isComplete: true
      }
    });

    const detail = await server.inject({
      method: "GET",
      url: "/candidates/candidate-delta-001"
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      sanctionsDeltaRecords: [
        {
          actionType: "ADD",
          recordType: "PERSON",
          sourceLocation: "Annex I; section 1; row 1"
        },
        {
          actionType: "ADD",
          recordType: "ENTITY",
          sourceLocation: "Annex I; section 2; row 2"
        }
      ],
      completeExtractionGate: {
        ready: true,
        blockers: []
      }
    });

    const exportResponse = await server.inject({
      method: "POST",
      url: "/export/candidates/candidate-delta-001/batches",
      payload: {
        actor: "harness@example.test"
      }
    });
    expect(exportResponse.statusCode).toBe(201);
    expect(exportResponse.json()).toMatchObject({
      exportBatch: {
        candidateId: "candidate-delta-001",
        recordCount: 2,
        fileHash: createHash("sha256").update(exportResponse.json().csv, "utf8").digest("hex")
      }
    });

    const reprocess = await server.inject({
      method: "POST",
      url: "/classification/candidates/candidate-delta-001/reprocess-source-content"
    });
    expect(reprocess.statusCode).toBe(200);
    expect(reprocess.json()).toMatchObject({
      reprocessed: true,
      candidate: {
        status: "EXPORTED"
      },
      reexportState: {
        reexportRequired: false
      }
    });
    expect(extractionResults).toHaveLength(2);
    expect(exportBatches).toHaveLength(1);

    const audit = await server.inject({
      method: "GET",
      url: "/audit/events?candidateId=candidate-delta-001"
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "RETRIEVAL_ATTEMPT_RECORDED" }),
        expect.objectContaining({ type: "EXPORT_BATCH_CREATED" }),
        expect.objectContaining({ type: "CANDIDATE_REPROCESSED" })
      ])
    );
    expect(JSON.stringify(auditEvents)).not.toContain("Jane Example");
    expect(JSON.stringify(auditEvents)).not.toContain("date of birth");
  });
});
