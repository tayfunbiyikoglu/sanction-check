import type { CandidateLegalAct, MonitorRun, SearchResponseReference, WatchQuery } from "@sanctions/domain";
import {
  normalizeLegalActIdentityInput,
  resolveLegalActIdentity
} from "@sanctions/domain";
import {
  candidateLegalActs,
  recordMonitorRun,
  refreshCandidateLegalActIdentity,
  sanctionsDeltaRecords,
  upsertCandidateLegalAct,
  watchQueries
} from "../seed-data.js";

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
      const { candidate, created } = mergeDiscoveryTrigger(trigger, watchQuery, finishedAt);
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

  const monitorRun = recordMonitorRun({
    id: createMonitorRunId(),
    startedAt,
    finishedAt,
    status: errors.length === 0 ? "SUCCESS" : seenCandidates.length > 0 ? "PARTIAL" : "FAILED",
    source: watchQuery.source,
    watchQueryId: watchQuery.id,
    querySnapshot: watchQuery.queryText,
    itemsSeen: input.itemsSeen ?? input.triggers.length,
    newCandidates,
    ...(input.searchResponse ? { searchResponse: input.searchResponse } : {}),
    ...(errors.length > 0 ? { errorMessage: errors.join("; ") } : {})
  });

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

export function mergeDiscoveryTrigger(
  trigger: DiscoveryTrigger,
  watchQuery: WatchQuery,
  seenAt: string
): { candidate: CandidateLegalAct; created: boolean } {
  const normalized = normalizeLegalActIdentityInput(trigger);
  const identity = resolveLegalActIdentity(normalized);
  const existing = findCandidateByAnyIdentity(normalized);

  if (existing) {
    applyDiscoveryTriggerToExistingCandidate(existing, trigger, seenAt);
    return { candidate: upsertCandidateLegalAct(existing), created: false };
  }

  const candidate: CandidateLegalAct = {
    id: createCandidateId(identity.value),
    ...normalized,
    legalActIdentityKind: identity.kind,
    legalActIdentityValue: identity.value,
    title: trigger.title,
    ...(trigger.publicationDate ? { publicationDate: trigger.publicationDate } : {}),
    status: "DETECTED",
    workingLanguage: "en",
    ...(trigger.sourceUrl ? { sourceUrl: trigger.sourceUrl } : {}),
    rssFeedName: trigger.rssFeedName ?? watchQuery.name,
    detectedAt: trigger.discoveredAt ?? seenAt,
    lastSeenAt: seenAt
  };

  return { candidate: upsertCandidateLegalAct(candidate), created: true };
}

function applyDiscoveryTriggerToExistingCandidate(
  candidate: CandidateLegalAct,
  trigger: DiscoveryTrigger,
  seenAt: string
): void {
  const normalized = normalizeLegalActIdentityInput(trigger);

  if (normalized.celexId) {
    candidate.celexId = normalized.celexId;
  }

  if (normalized.cellarId) {
    candidate.cellarId = normalized.cellarId;
  }

  if (normalized.officialUri) {
    candidate.officialUri = normalized.officialUri;
  }

  candidate.title = trigger.title || candidate.title;

  if (trigger.publicationDate) {
    candidate.publicationDate = trigger.publicationDate;
  }

  if (trigger.sourceUrl) {
    candidate.sourceUrl = trigger.sourceUrl;
  }

  if (trigger.rssFeedName) {
    candidate.rssFeedName = trigger.rssFeedName;
  }

  candidate.lastSeenAt = seenAt;
  refreshCandidateLegalActIdentity(candidate);
}

function findWatchQuery(watchQueryId: string): WatchQuery {
  const watchQuery = watchQueries.find((query) => query.id === watchQueryId && query.isActive);

  if (!watchQuery) {
    throw new Error(`Active watch query not found: ${watchQueryId}`);
  }

  return watchQuery;
}

function findCandidateByAnyIdentity(
  identityInput: ReturnType<typeof normalizeLegalActIdentityInput>
): CandidateLegalAct | undefined {
  return candidateLegalActs.find((candidate) => {
    const normalizedCandidate = normalizeLegalActIdentityInput(candidate);

    return (
      (identityInput.celexId !== undefined && normalizedCandidate.celexId === identityInput.celexId) ||
      (identityInput.cellarId !== undefined &&
        normalizedCandidate.cellarId === identityInput.cellarId) ||
      (identityInput.officialUri !== undefined &&
        normalizedCandidate.officialUri === identityInput.officialUri)
    );
  });
}

function createCandidateId(identityValue: string): string {
  const slug = identityValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  return `candidate-discovered-${slug || candidateLegalActs.length + 1}`;
}
