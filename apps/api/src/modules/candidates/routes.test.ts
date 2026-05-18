import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../app.js";
import { resetCandidateLegalActsForTests } from "../seed-data.js";

describe("candidate legal act routes", () => {
  beforeEach(() => {
    resetCandidateLegalActsForTests();
  });

  it("lists seeded candidate legal acts from the application store", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/candidates" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      candidates: [
        { id: "candidate-delta-001", status: "EXTRACTED_COMPLETE" },
        { id: "candidate-correction-001", status: "NEEDS_EXTRACTION_CORRECTION" },
        { id: "candidate-no-delta-001", status: "NO_DELTA" },
        { id: "candidate-language-pending-001", status: "LANGUAGE_PENDING" },
        { id: "candidate-retrieval-failed-001", status: "FAILED_RETRIEVAL" }
      ]
    });
  });

  it("exposes retrieval state on candidate detail without embedding source content bytes", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/candidates/candidate-language-pending-001"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      candidate: {
        id: "candidate-language-pending-001",
        retrieval: {
          status: "LANGUAGE_PENDING",
          attempts: 1,
          availableLanguages: ["fr", "de"]
        }
      },
      completeExtractionGate: {
        ready: false,
        blockers: expect.arrayContaining(["Official English source content is not available yet"])
      }
    });
    expect(JSON.stringify(response.json())).not.toContain("<annexe");
  });

  it("returns monitor overview counts for seeded candidates", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/monitoring/overview" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      overview: {
        lastSuccessfulRun: "2026-05-17T08:00:00.000Z",
        candidatesToday: 5,
        candidatesNeedingExtractionCorrection: 1,
        completeExtractionsReadyForExport: 1,
        exportBatchesCreatedToday: 0,
        failedRetrievalOrParsing: 1
      }
    });
    expect(response.json().operationalAlerts).toEqual(expect.any(Array));
  });
});
