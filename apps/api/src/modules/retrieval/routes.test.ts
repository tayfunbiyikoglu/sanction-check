import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../app.js";
import { resetCandidateLegalActsForTests } from "../seed-data.js";

describe("source retrieval routes", () => {
  let sourceContentRoot: string | undefined;

  beforeEach(async () => {
    resetCandidateLegalActsForTests();
    sourceContentRoot = await mkdtemp(path.join(tmpdir(), "route-source-content-"));
    process.env.SOURCE_CONTENT_STORAGE_DIR = sourceContentRoot;
  });

  afterEach(async () => {
    delete process.env.SOURCE_CONTENT_STORAGE_DIR;
    delete process.env.CELLAR_RETRIEVAL_MODE;
    delete process.env.CELLAR_ENDPOINT_URL;
    if (sourceContentRoot) {
      await rm(sourceContentRoot, { recursive: true, force: true });
    }
  });

  it("retrieves official English source content and exposes it by immutable reference", async () => {
    const server = buildServer();
    const retrieveResponse = await server.inject({
      method: "POST",
      url: "/retrieval/candidates/candidate-delta-001/retrieve-source-content"
    });

    expect(retrieveResponse.statusCode).toBe(200);
    expect(retrieveResponse.json()).toMatchObject({
      candidate: {
        id: "candidate-delta-001",
        status: "CONTENT_RETRIEVED"
      },
      retrieval: {
        status: "CONTENT_RETRIEVED"
      },
      sourceContent: {
        reference: expect.stringMatching(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.xml$/),
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        contentType: "application/xml",
        language: "en",
        sourceUri: "cellar:mock:32026R1001/en/xml"
      }
    });

    const sourceResponse = await server.inject({
      method: "GET",
      url: "/retrieval/candidates/candidate-delta-001/source-content"
    });

    expect(sourceResponse.statusCode).toBe(200);
    expect(sourceResponse.json()).toMatchObject({
      candidateId: "candidate-delta-001",
      sourceContent: {
        language: "en",
        contentType: "application/xml"
      },
      content: expect.stringContaining("legalAct")
    });
  });

  it("uses live CELLAR mode independently and records a clear missing-config retrieval error", async () => {
    process.env.CELLAR_RETRIEVAL_MODE = "live";
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/retrieval/candidates/candidate-delta-001/retrieve-source-content"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      candidate: {
        id: "candidate-delta-001",
        status: "FAILED_RETRIEVAL"
      },
      retrieval: {
        status: "FAILED_RETRIEVAL",
        failureCode: "CELLAR_CONFIG_MISSING",
        failureMessage: "CELLAR endpoint URL is required for live retrieval"
      }
    });
  });
});
