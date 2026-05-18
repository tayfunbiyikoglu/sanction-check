import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../app.js";
import {
  auditEvents,
  candidateLegalActs,
  extractionResults,
  monitorRuns,
  resetCandidateLegalActsForTests
} from "../seed-data.js";

const originalMonitorRuns = structuredClone(monitorRuns);

describe("audit routes", () => {
  beforeEach(() => {
    resetCandidateLegalActsForTests();
    monitorRuns.splice(0, monitorRuns.length, ...structuredClone(originalMonitorRuns));
  });

  it("appends audit events through the API and redacts sensitive payload fields", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/audit/events",
      payload: {
        type: "AUDIT_EVENT_RECORDED",
        actor: "control-owner@example.test",
        candidateId: "candidate-delta-001",
        occurredAt: "2026-05-17T09:00:00.000Z",
        payload: {
          status: "CONTROL_CHECKED",
          primaryName: "Do Not Log",
          evidenceText: "Do not log Evidence Text",
          listedEntry: { dateOfBirth: "Do Not Log" },
          fieldNames: ["primaryName", "listedEntry"]
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      auditEvent: {
        id: "audit-event-000001",
        type: "AUDIT_EVENT_RECORDED",
        actor: "control-owner@example.test",
        candidateId: "candidate-delta-001",
        occurredAt: "2026-05-17T09:00:00.000Z",
        payload: {
          status: "CONTROL_CHECKED",
          primaryName: "[REDACTED]",
          evidenceText: "[REDACTED]",
          listedEntry: "[REDACTED]",
          fieldNames: ["primaryName", "listedEntry"]
        }
      }
    });

    const listed = await server.inject({ method: "GET", url: "/audit/events?candidateId=candidate-delta-001" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().auditEvents).toHaveLength(1);
    expect(JSON.stringify(listed.json())).not.toContain("Do Not Log");
    expect(auditEvents).toHaveLength(1);
  });

  it("exposes dashboard-visible operational alerts when thresholds are crossed", async () => {
    const failedRetrieval = candidateLegalActs.find((candidate) => candidate.id === "candidate-retrieval-failed-001")!;
    failedRetrieval.retrieval = {
      ...failedRetrieval.retrieval!,
      attempts: 3,
      lastAttemptAt: "2026-05-17T08:03:00.000Z"
    };

    const languagePending = candidateLegalActs.find((candidate) => candidate.id === "candidate-language-pending-001")!;
    languagePending.retrieval = {
      ...languagePending.retrieval!,
      lastAttemptAt: "2026-05-16T08:02:00.000Z"
    };

    const parsingFailed = candidateLegalActs.find((candidate) => candidate.id === "candidate-correction-001")!;
    parsingFailed.status = "FAILED_PARSING";
    extractionResults.push({
      id: "extraction-candidate-correction-001-failed",
      candidateId: parsingFailed.id,
      parserVersion: "deterministic-classifier-v1",
      classification: "PARSING_FAILED",
      confidence: 0,
      annexFound: false,
      isComplete: false,
      createdAt: "2026-05-17T08:30:00.000Z"
    });

    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/audit/alerts?asOf=2026-05-17T11:00:00.000Z"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      thresholds: {
        monitorRunStaleAfterHours: 2,
        repeatedRetrievalFailureAttempts: 3,
        languagePendingAfterHours: 24
      }
    });

    const alerts = response.json().operationalAlerts as Array<{ type: string; candidateId?: string }>;
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "STALE_MONITOR_RUN" }),
        expect.objectContaining({
          type: "REPEATED_RETRIEVAL_FAILURES",
          candidateId: "candidate-retrieval-failed-001"
        }),
        expect.objectContaining({
          type: "PARSING_FAILURE",
          candidateId: "candidate-correction-001"
        }),
        expect.objectContaining({
          type: "LANGUAGE_PENDING_OVER_THRESHOLD",
          candidateId: "candidate-language-pending-001"
        })
      ])
    );

    const overview = await server.inject({
      method: "GET",
      url: "/monitoring/overview"
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().operationalAlerts).toEqual(expect.any(Array));
  });
});
