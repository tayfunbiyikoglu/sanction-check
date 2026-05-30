import type { CandidateLegalAct, MonitorRun, SearchResponseReference, WatchQuery } from "@sanctions/domain";
import {
  normalizeLegalActIdentityInput,
  resolveLegalActIdentity
} from "@sanctions/domain";
import type { DiscoveryTrigger } from "./service.js";

export interface DiscoveryMergeInput {
  existingCandidates: CandidateLegalAct[];
  fallbackCandidateIdSeed: string | number;
  seenAt: string;
  trigger: DiscoveryTrigger;
  watchQuery: WatchQuery;
}

export interface DiscoveryMergeResult {
  candidate: CandidateLegalAct;
  created: boolean;
}

export interface BuildMonitorRunInput {
  discoveryErrors?: string[];
  finishedAt: string;
  itemsSeen?: number;
  monitorRunId: string;
  searchResponse?: SearchResponseReference;
  seenCandidateCount: number;
  startedAt: string;
  triggerCount: number;
  watchQuery: WatchQuery;
  newCandidates: number;
}

export function mergeDiscoveryTrigger(input: DiscoveryMergeInput): DiscoveryMergeResult {
  const normalized = normalizeLegalActIdentityInput(input.trigger);
  const identity = resolveLegalActIdentity(normalized);
  const existing = findCandidateByAnyIdentity(input.existingCandidates, normalized);

  if (existing) {
    return {
      candidate: refreshCandidateFromDiscoveryTrigger({
        candidate: existing,
        seenAt: input.seenAt,
        trigger: input.trigger
      }),
      created: false
    };
  }

  return {
    candidate: {
      id: createCandidateId(identity.value, input.fallbackCandidateIdSeed),
      ...normalized,
      legalActIdentityKind: identity.kind,
      legalActIdentityValue: identity.value,
      title: input.trigger.title,
      ...(input.trigger.publicationDate ? { publicationDate: input.trigger.publicationDate } : {}),
      status: "DETECTED",
      workingLanguage: "en",
      ...(input.trigger.sourceUrl ? { sourceUrl: input.trigger.sourceUrl } : {}),
      rssFeedName: input.trigger.rssFeedName ?? input.watchQuery.name,
      detectedAt: input.trigger.discoveredAt ?? input.seenAt,
      lastSeenAt: input.seenAt
    },
    created: true
  };
}

export function refreshCandidateFromDiscoveryTrigger(input: {
  candidate: CandidateLegalAct;
  trigger: DiscoveryTrigger;
  seenAt: string;
}): CandidateLegalAct {
  const normalized = normalizeLegalActIdentityInput(input.trigger);
  const enriched = {
    ...input.candidate,
    ...(normalized.celexId ? { celexId: normalized.celexId } : {}),
    ...(normalized.cellarId ? { cellarId: normalized.cellarId } : {}),
    ...(normalized.officialUri ? { officialUri: normalized.officialUri } : {}),
    title: input.trigger.title || input.candidate.title,
    ...(input.trigger.publicationDate ? { publicationDate: input.trigger.publicationDate } : {}),
    ...(input.trigger.sourceUrl ? { sourceUrl: input.trigger.sourceUrl } : {}),
    ...(input.trigger.rssFeedName ? { rssFeedName: input.trigger.rssFeedName } : {}),
    lastSeenAt: input.seenAt
  };
  const identity = resolveLegalActIdentity(enriched);

  return {
    ...enriched,
    legalActIdentityKind: identity.kind,
    legalActIdentityValue: identity.value
  };
}

export function findCandidateByAnyIdentity(
  candidates: CandidateLegalAct[],
  identityInput: ReturnType<typeof normalizeLegalActIdentityInput>
): CandidateLegalAct | undefined {
  return candidates.find((candidate) => {
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

export function buildMonitorRun(input: BuildMonitorRunInput): MonitorRun {
  const errors = input.discoveryErrors ?? [];

  return {
    id: input.monitorRunId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    status: errors.length === 0 ? "SUCCESS" : input.seenCandidateCount > 0 ? "PARTIAL" : "FAILED",
    source: input.watchQuery.source,
    watchQueryId: input.watchQuery.id,
    querySnapshot: input.watchQuery.queryText,
    itemsSeen: input.itemsSeen ?? input.triggerCount,
    newCandidates: input.newCandidates,
    ...(input.searchResponse ? { searchResponse: input.searchResponse } : {}),
    ...(errors.length > 0 ? { errorMessage: errors.join("; ") } : {})
  };
}

export function createCandidateId(identityValue: string, fallbackSeed: string | number): string {
  const slug = identityValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  return `candidate-discovered-${slug || fallbackSeed}`;
}
