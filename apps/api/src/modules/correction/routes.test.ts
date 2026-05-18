import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../app.js";
import {
  resetCandidateLegalActsForTests,
  sanctionsDeltaRecords
} from "../seed-data.js";

describe("extraction correction routes", () => {
  let sourceContentRoot: string | undefined;

  beforeEach(async () => {
    resetCandidateLegalActsForTests();
    sourceContentRoot = await mkdtemp(path.join(tmpdir(), "correction-source-content-"));
    process.env.SOURCE_CONTENT_STORAGE_DIR = sourceContentRoot;
  });

  afterEach(async () => {
    delete process.env.SOURCE_CONTENT_STORAGE_DIR;
    if (sourceContentRoot) {
      await rm(sourceContentRoot, { recursive: true, force: true });
    }
  });

  it("applies source-backed field corrections and appends correction audit", async () => {
    const server = buildServer();
    await retrieveAndClassifyDeltaCandidate(server);

    const response = await server.inject({
      method: "PATCH",
      url: "/correction/candidates/candidate-delta-001/records/delta-candidate-delta-001-annex-i-section-1-row-1/source-backed-fields",
      payload: {
        actor: "analyst@example.test",
        fields: {
          primaryName: "Jane Example Corrected",
          listedEntry: {
            name: "Jane Example Corrected",
            dateOfBirth: "12 March 1975"
          }
        },
        evidenceText: "Jane Example; date of birth: 12 March 1975.",
        sourceLocation: "Annex I; section 1; row 1",
        comment: "Corrected source-backed name transcription"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      record: {
        primaryName: "Jane Example Corrected",
        listedEntry: {
          name: "Jane Example Corrected",
          dateOfBirth: "12 March 1975"
        }
      },
      correctionAction: {
        actionType: "FIELD_CORRECTION",
        actor: "analyst@example.test",
        beforeValues: {
          primaryName: "Jane Example",
          listedEntry: {
            name: "Jane Example"
          }
        },
        afterValues: {
          primaryName: "Jane Example Corrected",
          listedEntry: {
            name: "Jane Example Corrected",
            dateOfBirth: "12 March 1975"
          }
        },
        comment: "Corrected source-backed name transcription"
      }
    });

    const detailResponse = await server.inject({
      method: "GET",
      url: "/candidates/candidate-delta-001"
    });

    expect(detailResponse.json()).toMatchObject({
      correctionActions: [
        {
          actionType: "FIELD_CORRECTION",
          recordId: "delta-candidate-delta-001-annex-i-section-1-row-1"
        }
      ]
    });
  });

  it("adds missed records only when source context lets the parser infer action and record type", async () => {
    const server = buildServer();
    await retrieveAndClassifyDeltaCandidate(server);
    const missed = sanctionsDeltaRecords.find((record) => record.sourceLocation === "Annex I; section 2; row 2");

    expect(missed).toBeDefined();
    sanctionsDeltaRecords.splice(sanctionsDeltaRecords.indexOf(missed!), 1);

    const response = await server.inject({
      method: "POST",
      url: "/correction/candidates/candidate-delta-001/missed-records",
      payload: {
        actor: "analyst@example.test",
        sourceLocation: "Annex I; section 2; row 2",
        comment: "Added missed entity row from Annex I"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      record: {
        recordType: "ENTITY",
        actionType: "ADD",
        primaryName: "Example Entity Ltd",
        sourceLocation: "Annex I; section 2; row 2"
      },
      correctionAction: {
        actionType: "MISSED_RECORD_ADDITION",
        actor: "analyst@example.test",
        beforeValues: {},
        afterValues: {
          record: {
            recordType: "ENTITY",
            actionType: "ADD"
          }
        }
      }
    });
  });

  it("rejects unsourced field correction evidence", async () => {
    const server = buildServer();
    await retrieveAndClassifyDeltaCandidate(server);

    const response = await server.inject({
      method: "PATCH",
      url: "/correction/candidates/candidate-delta-001/records/delta-candidate-delta-001-annex-i-section-1-row-1/source-backed-fields",
      payload: {
        actor: "analyst@example.test",
        fields: { primaryName: "Unsourced Name" },
        evidenceText: "Text that is not in the official source",
        sourceLocation: "Annex I; section 1; row 1"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: "Correction evidence must be selected from official source content"
    });
  });

  it("rejects manual false-positive deletion, Delta Action edits, and person/entity reclassification", async () => {
    const server = buildServer();
    await retrieveAndClassifyDeltaCandidate(server);

    const deletionResponse = await server.inject({
      method: "DELETE",
      url: "/correction/candidates/candidate-delta-001/records/delta-candidate-delta-001-annex-i-section-1-row-1"
    });
    expect(deletionResponse.statusCode).toBe(409);
    expect(deletionResponse.json()).toEqual({
      message: "Manual false-positive deletion is not allowed; fix parser rules and reprocess the candidate legal act"
    });

    const actionResponse = await server.inject({
      method: "PATCH",
      url: "/correction/candidates/candidate-delta-001/records/delta-candidate-delta-001-annex-i-section-1-row-1/source-backed-fields",
      payload: {
        actor: "analyst@example.test",
        fields: { actionType: "REMOVE" },
        evidenceText: "Jane Example; date of birth: 12 March 1975.",
        sourceLocation: "Annex I; section 1; row 1"
      }
    });
    expect(actionResponse.statusCode).toBe(409);
    expect(actionResponse.json()).toEqual({
      message: "Manual Delta Action changes are not allowed; fix parser rules and reprocess the candidate legal act"
    });

    const recordTypeResponse = await server.inject({
      method: "PATCH",
      url: "/correction/candidates/candidate-delta-001/records/delta-candidate-delta-001-annex-i-section-1-row-1/source-backed-fields",
      payload: {
        actor: "analyst@example.test",
        fields: { recordType: "ENTITY" },
        evidenceText: "Jane Example; date of birth: 12 March 1975.",
        sourceLocation: "Annex I; section 1; row 1"
      }
    });
    expect(recordTypeResponse.statusCode).toBe(409);
    expect(recordTypeResponse.json()).toEqual({
      message: "Manual person/entity reclassification is not allowed; fix parser rules and reprocess the candidate legal act"
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
