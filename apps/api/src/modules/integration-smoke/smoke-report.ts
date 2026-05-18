import type { CandidateLegalAct, SourceContentReference, WatchQuery } from "@sanctions/domain";
import { resolveLegalActIdentity } from "@sanctions/domain";
import type { DiscoveryTrigger } from "../monitoring/service.js";
import type { SearchResponseReference } from "@sanctions/domain";

export interface SearchSmokeReportInput {
  watchQuery: WatchQuery;
  triggers: DiscoveryTrigger[];
  errors: string[];
  searchResponse: SearchResponseReference;
}

export interface CellarSmokeReportInput {
  candidate: CandidateLegalAct;
  availableLanguageCount: number;
  sourceContent?: SourceContentReference;
}

export interface RssSmokeReportInput {
  watchQuery: WatchQuery;
  feedUrl: string;
  triggers: DiscoveryTrigger[];
  errors: string[];
}

export function buildSafeSearchSmokeReport(input: SearchSmokeReportInput) {
  return {
    ok: true,
    watchQueryId: input.watchQuery.id,
    discoveryTriggerCount: input.triggers.length,
    malformedTriggerErrorCount: input.errors.length,
    legalActIdentities: input.triggers.map((trigger) => resolveLegalActIdentity(trigger)),
    searchResponse: {
      reference: input.searchResponse.reference,
      contentHash: input.searchResponse.contentHash,
      contentLength: input.searchResponse.contentLength,
      contentType: input.searchResponse.contentType,
      sourceUri: input.searchResponse.sourceUri,
      retrievedAt: input.searchResponse.retrievedAt
    }
  };
}

export function buildSafeCellarSmokeReport(input: CellarSmokeReportInput) {
  const legalActIdentity = resolveLegalActIdentity(input.candidate);

  return {
    ok: Boolean(input.sourceContent),
    candidateId: input.candidate.id,
    legalActIdentity,
    retrievalStatus: input.candidate.retrieval?.status,
    failureCode: input.candidate.retrieval?.failureCode,
    availableLanguageCount: input.availableLanguageCount,
    sourceContent: input.sourceContent
      ? {
          reference: input.sourceContent.reference,
          contentHash: input.sourceContent.contentHash,
          contentLength: input.sourceContent.contentLength,
          contentType: input.sourceContent.contentType,
          language: input.sourceContent.language,
          sourceUri: input.sourceContent.sourceUri,
          retrievedAt: input.sourceContent.retrievedAt
        }
      : undefined
  };
}

export function buildSafeRssSmokeReport(input: RssSmokeReportInput) {
  return {
    ok: true,
    watchQueryId: input.watchQuery.id,
    feedUrl: input.feedUrl,
    discoveryTriggerCount: input.triggers.length,
    malformedTriggerErrorCount: input.errors.length,
    legalActIdentities: input.triggers.map((trigger) => resolveLegalActIdentity(trigger))
  };
}

export function requireLiveSmokeOptIn(env: NodeJS.ProcessEnv) {
  if (env.RUN_LIVE_EURLEX_SMOKE !== "1") {
    return {
      ok: false,
      skipped: true,
      reason: "Set RUN_LIVE_EURLEX_SMOKE=1 to run live EUR-Lex smoke tests."
    };
  }

  return undefined;
}
