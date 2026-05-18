import { beforeEach, describe, expect, it } from "vitest";
import type { CandidateLegalAct, MonitorRun } from "@sanctions/domain";
import {
  candidateLegalActs,
  monitorRuns,
  sanctionsDeltaRecords,
  watchQueries
} from "../seed-data.js";
import { executeMonitorRun } from "./service.js";

const originalCandidates = structuredClone(candidateLegalActs);
const originalMonitorRuns = structuredClone(monitorRuns);
const originalDeltaRecords = structuredClone(sanctionsDeltaRecords);

describe("monitoring deduplication", () => {
  beforeEach(() => {
    restore(candidateLegalActs, originalCandidates);
    restore(monitorRuns, originalMonitorRuns);
    restore(sanctionsDeltaRecords, originalDeltaRecords);
  });

  it("deduplicates repeated discovery triggers by CELEX identity", () => {
    const result = executeMonitorRun({
      watchQueryId: watchQueries[0]!.id,
      startedAt: "2026-05-17T09:00:00.000Z",
      finishedAt: "2026-05-17T09:00:01.000Z",
      triggers: [
        {
          celexId: "32026r2001",
          cellarId: "cellar-old",
          officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R2001",
          title: "First discovery trigger"
        },
        {
          celexId: " 32026R2001 ",
          cellarId: "cellar-new",
          officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R2001",
          title: "Rediscovered legal act"
        }
      ]
    });

    const matches = candidateLegalActs.filter((candidate) => candidate.celexId === "32026R2001");

    expect(result.monitorRun).toMatchObject({
      status: "SUCCESS",
      querySnapshot: watchQueries[0]!.queryText,
      itemsSeen: 2,
      newCandidates: 1
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      title: "Rediscovered legal act",
      legalActIdentityKind: "CELEX",
      legalActIdentityValue: "32026R2001",
      lastSeenAt: "2026-05-17T09:00:01.000Z"
    });
  });

  it("falls back to CELLAR identity when CELEX is not present", () => {
    executeMonitorRun({
      watchQueryId: watchQueries[0]!.id,
      finishedAt: "2026-05-17T10:00:00.000Z",
      triggers: [
        {
          cellarId: " CELLAR-2002 ",
          title: "CELLAR-only discovery trigger"
        },
        {
          cellarId: "cellar-2002",
          title: "Repeated CELLAR discovery trigger"
        }
      ]
    });

    const matches = candidateLegalActs.filter(
      (candidate) => candidate.legalActIdentityValue === "cellar-2002"
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      cellarId: "cellar-2002",
      legalActIdentityKind: "CELLAR",
      title: "Repeated CELLAR discovery trigger"
    });
  });

  it("falls back to official document URI identity and later upgrades to CELEX identity", () => {
    const officialUri =
      "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R2003";

    executeMonitorRun({
      watchQueryId: watchQueries[0]!.id,
      finishedAt: "2026-05-17T11:00:00.000Z",
      triggers: [
        {
          officialUri,
          title: "URI-only discovery trigger"
        }
      ]
    });

    executeMonitorRun({
      watchQueryId: watchQueries[0]!.id,
      finishedAt: "2026-05-17T12:00:00.000Z",
      triggers: [
        {
          celexId: "32026R2003",
          officialUri,
          title: "Official metadata discovery trigger"
        }
      ]
    });

    const matches = candidateLegalActs.filter((candidate) => candidate.officialUri === officialUri);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      celexId: "32026R2003",
      legalActIdentityKind: "CELEX",
      legalActIdentityValue: "32026R2003",
      title: "Official metadata discovery trigger"
    });
  });

  it("treats discovery triggers as non-authoritative and does not create sanctions delta records", () => {
    const before = sanctionsDeltaRecords.length;

    executeMonitorRun({
      watchQueryId: watchQueries[0]!.id,
      triggers: [
        {
          celexId: "32026R2004",
          title: "Discovery trigger with no source content"
        }
      ]
    });

    expect(sanctionsDeltaRecords).toHaveLength(before);
  });
});

function restore<T extends CandidateLegalAct | MonitorRun>(target: T[], source: T[]): void;
function restore(target: typeof sanctionsDeltaRecords, source: typeof sanctionsDeltaRecords): void;
function restore<T>(target: T[], source: T[]): void {
  target.splice(0, target.length, ...structuredClone(source));
}
