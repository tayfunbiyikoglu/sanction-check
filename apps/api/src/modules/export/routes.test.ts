import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../app.js";
import {
  exportBatchFiles,
  exportBatchRecords,
  exportBatches,
  exportDownloadEvents,
  resetCandidateLegalActsForTests,
  sanctionsDeltaRecords
} from "../seed-data.js";

describe("export routes", () => {
  let sourceContentRoot: string | undefined;

  beforeEach(async () => {
    resetCandidateLegalActsForTests();
    sourceContentRoot = await mkdtemp(path.join(tmpdir(), "export-source-content-"));
    process.env.SOURCE_CONTENT_STORAGE_DIR = sourceContentRoot;
  });

  afterEach(async () => {
    delete process.env.SOURCE_CONTENT_STORAGE_DIR;
    if (sourceContentRoot) {
      await rm(sourceContentRoot, { recursive: true, force: true });
    }
  });

  it("creates one immutable audit CSV batch for a complete candidate legal act", async () => {
    const server = buildServer();
    await retrieveAndClassifyDeltaCandidate(server);

    const response = await server.inject({
      method: "POST",
      url: "/export/candidates/candidate-delta-001/batches",
      payload: { actor: "audit-owner" }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    const csv = body.csv as string;

    expect(body.exportBatch).toMatchObject({
      candidateId: "candidate-delta-001",
      createdBy: "audit-owner",
      status: "CREATED",
      recordCount: 2,
      fileHash: createHash("sha256").update(csv, "utf8").digest("hex"),
      extractionSnapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
    expect(body.exportBatchRecords).toEqual([
      { exportBatchId: body.exportBatch.id, recordId: "delta-candidate-delta-001-annex-i-section-1-row-1" },
      { exportBatchId: body.exportBatch.id, recordId: "delta-candidate-delta-001-annex-i-section-2-row-2" }
    ]);
    expect(csv).toContain("COUNTRYOFORIGIN,ENTRYDATE,FIRSTNAME,GENDER,ID,ISDELETED,JUSTIFICATION,LEGALSTATUS,NAME,YEAR");
    expect(csv).toContain(",Jane,MALE,");
    expect(csv).toContain("NATURAL_PERSON,EXAMPLE");
    expect(csv).toContain("LEGAL_ENTITY,Example Entity Ltd");
    expect(csv.indexOf("NATURAL_PERSON,EXAMPLE")).toBeLessThan(csv.indexOf("LEGAL_ENTITY,Example Entity Ltd"));
    expect(exportBatches).toHaveLength(1);
    expect(exportBatchRecords).toHaveLength(2);
    expect(exportBatchFiles[0]?.csv).toBe(csv);
  });

  it("requires a re-export reason only after the current complete extraction differs from the latest export", async () => {
    const server = buildServer();
    await retrieveAndClassifyDeltaCandidate(server);

    const first = await server.inject({
      method: "POST",
      url: "/export/candidates/candidate-delta-001/batches",
      payload: { actor: "audit-owner" }
    });
    const duplicate = await server.inject({
      method: "POST",
      url: "/export/candidates/candidate-delta-001/batches",
      payload: { actor: "audit-owner" }
    });
    sanctionsDeltaRecords[0]!.evidenceText = "Changed source evidence after parser rule update";
    const changedWithoutReason = await server.inject({
      method: "POST",
      url: "/export/candidates/candidate-delta-001/batches",
      payload: { actor: "audit-owner" }
    });
    const reexport = await server.inject({
      method: "POST",
      url: "/export/candidates/candidate-delta-001/batches",
      payload: { actor: "audit-owner", reexportReason: "Parser re-run changed the complete extraction" }
    });

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      message: "Current complete extraction matches latest export batch; no re-export required"
    });
    expect(changedWithoutReason.statusCode).toBe(409);
    expect(changedWithoutReason.json()).toMatchObject({
      message: "Current complete extraction differs from latest export batch; provide a re-export reason"
    });
    expect(reexport.statusCode).toBe(201);
    expect(reexport.json().exportBatch).toMatchObject({
      reexportOfBatchId: first.json().exportBatch.id,
      reexportReason: "Parser re-run changed the complete extraction"
    });
    expect(exportBatches).toHaveLength(2);
  });

  it("blocks export when the complete extraction gate is not ready", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/export/candidates/candidate-correction-001/batches",
      payload: { actor: "audit-owner" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      message: "Candidate legal act has not been classified"
    });
  });

  it("records download events without changing the immutable batch file", async () => {
    const server = buildServer();
    await retrieveAndClassifyDeltaCandidate(server);
    const exportResponse = await server.inject({
      method: "POST",
      url: "/export/candidates/candidate-delta-001/batches",
      payload: { actor: "audit-owner" }
    });
    const batch = exportResponse.json().exportBatch;
    const originalCsv = exportResponse.json().csv;
    sanctionsDeltaRecords[0]!.primaryName = "Mutated after export";

    const download = await server.inject({
      method: "GET",
      url: `/export/batches/${batch.id}/download?actor=download-user`
    });

    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("text/csv");
    expect(download.body).toBe(originalCsv);
    expect(download.body).toContain("NATURAL_PERSON,EXAMPLE");
    expect(download.body).not.toContain("Mutated after export");
    expect(exportDownloadEvents).toHaveLength(1);
    expect(exportDownloadEvents[0]).toMatchObject({
      exportBatchId: batch.id,
      downloadedBy: "download-user"
    });
  });
});

async function retrieveAndClassifyDeltaCandidate(server: ReturnType<typeof buildServer>) {
  await server.inject({
    method: "POST",
    url: "/retrieval/candidates/candidate-delta-001/retrieve-source-content"
  });
  await server.inject({
    method: "POST",
    url: "/classification/candidates/candidate-delta-001/classify-source-content"
  });
}
