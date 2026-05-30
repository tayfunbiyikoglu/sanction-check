import type { CandidateLegalAct, MonitorRun, SearchResponseReference, WatchQuery } from "@sanctions/domain";
import {
  candidateLegalActs,
  recordMonitorRun,
  sanctionsDeltaRecords,
  upsertCandidateLegalAct,
  watchQueries
} from "../seed-data.js";
import { buildMonitorRun, mergeDiscoveryTrigger as mergeDiscoveryTriggerCore } from "./discovery.js";

let monitorRunSequence = 1;

export interface DiscoveryTrigger {
  celexId?: string;
  cellarId?: string;
  officialUri?: string;
  sourceItemId?: string;
  sourceItemHash?: string;
  title: string;
  publicationDate?: string;
  sourceUrl?: string;
  rssFeedName?: string;
  discoveredAt?: string;
  rawMetadata?: Record<string, unknown>;
}

export interface ExecuteMonitorRunInput {
  watchQueryId: string;
  triggers: DiscoveryTrigger[];
  startedAt?: string;
  finishedAt?: string;
  searchResponse?: SearchResponseReference;
  discoveryErrors?: string[];
  itemsSeen?: number;
}

export interface ExecuteMonitorRunResult {
  monitorRun: MonitorRun;
  candidates: CandidateLegalAct[];
  errors: string[];
}

export function executeMonitorRun(input: ExecuteMonitorRunInput): ExecuteMonitorRunResult {
  const watchQuery = findWatchQuery(input.watchQueryId);
  const startedAt = input.startedAt ?? new Date().toISOString();
  const finishedAt = input.finishedAt ?? startedAt;
  const seenCandidates: CandidateLegalAct[] = [];
  const errors: string[] = [...(input.discoveryErrors ?? [])];
  let newCandidates = 0;
  const recordCountBefore = sanctionsDeltaRecords.length;

  for (const trigger of input.triggers) {
    try {
      const { candidate, created } = mergeDiscoveryTriggerCore({
        existingCandidates: candidateLegalActs,
        fallbackCandidateIdSeed: candidateLegalActs.length + 1,
        seenAt: finishedAt,
        trigger,
        watchQuery
      });
      upsertCandidateLegalAct(candidate);
      seenCandidates.push(candidate);

      if (created) {
        newCandidates += 1;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Discovery trigger failed");
    }
  }

  if (sanctionsDeltaRecords.length !== recordCountBefore) {
    throw new Error("Discovery triggers must not create sanctions delta records");
  }

  const monitorRun = recordMonitorRun(buildMonitorRun({
    discoveryErrors: errors,
    finishedAt,
    monitorRunId: createMonitorRunId(),
    newCandidates,
    seenCandidateCount: seenCandidates.length,
    startedAt,
    triggerCount: input.triggers.length,
    watchQuery,
    ...(input.itemsSeen !== undefined ? { itemsSeen: input.itemsSeen } : {}),
    ...(input.searchResponse ? { searchResponse: input.searchResponse } : {})
  }));

  return {
    monitorRun,
    candidates: seenCandidates,
    errors
  };
}

function createMonitorRunId(): string {
  const timestamp = String(Date.now()).padStart(13, "0");
  const sequence = String(monitorRunSequence++).padStart(4, "0");
  return `monitor-run-${timestamp}-${sequence}`;
}

function findWatchQuery(watchQueryId: string): WatchQuery {
  const watchQuery = watchQueries.find((query) => query.id === watchQueryId && query.isActive);

  if (!watchQuery) {
    throw new Error(`Active watch query not found: ${watchQueryId}`);
  }

  return watchQuery;
}
