import type { CandidateLegalAct } from "@sanctions/domain";
import { RetrievalFailure } from "./mock-eurlex-cellar-adapter.js";
import type {
  OfficialSourceAdapter,
  OfficialSourceContent,
  RetrievalClock,
  SourceContentRepository,
  StorableOfficialSourceContent
} from "./types.js";

const retryDelayMinutes = 30;

export class SourceRetrievalService {
  constructor(
    private readonly adapter: OfficialSourceAdapter,
    private readonly repository: SourceContentRepository,
    private readonly clock: RetrievalClock
  ) {}

  async retrieveEnglishSourceContent(candidate: CandidateLegalAct): Promise<CandidateLegalAct> {
    const attemptedAt = this.clock.now();
    const attempts = (candidate.retrieval?.attempts ?? 0) + 1;

    try {
      const lookup = await this.adapter.retrieve(candidate);
      const englishContent = selectEnglishSourceContent(lookup.contents);

      if (!englishContent) {
        const { sourceContent: _sourceContent, ...candidateWithoutSourceContent } = candidate;
        return {
          ...candidateWithoutSourceContent,
          status: "LANGUAGE_PENDING",
          retrieval: {
            status: "LANGUAGE_PENDING",
            attempts,
            lastAttemptAt: attemptedAt.toISOString(),
            nextRetryAt: addMinutes(attemptedAt, retryDelayMinutes).toISOString(),
            availableLanguages: lookup.availableLanguages
          }
        };
      }

      const sourceContent = await this.repository.store({
        candidateId: candidate.id,
        content: englishContent,
        retrievedAt: attemptedAt.toISOString()
      });
      const sourceContentChanged = Boolean(
        candidate.sourceContent && candidate.sourceContent.contentHash !== sourceContent.contentHash
      );

      return {
        ...candidate,
        status: "CONTENT_RETRIEVED",
        retrieval: {
          status: "CONTENT_RETRIEVED",
          attempts,
          lastAttemptAt: attemptedAt.toISOString(),
          availableLanguages: lookup.availableLanguages,
          ...(sourceContentChanged ? { sourceContentChanged: true } : {}),
          ...(sourceContentChanged && candidate.sourceContent
            ? { previousSourceContentHash: candidate.sourceContent.contentHash }
            : {})
        },
        sourceContent
      };
    } catch (cause) {
      const failure = normalizeRetrievalFailure(cause);
      const { sourceContent: _sourceContent, ...candidateWithoutSourceContent } = candidate;

      return {
        ...candidateWithoutSourceContent,
        status: "FAILED_RETRIEVAL",
        retrieval: {
          status: "FAILED_RETRIEVAL",
          attempts,
          lastAttemptAt: attemptedAt.toISOString(),
          nextRetryAt: addMinutes(attemptedAt, retryDelayMinutes).toISOString(),
          failureCode: failure.code,
          failureMessage: failure.message
        }
      };
    }
  }
}

function selectEnglishSourceContent(contents: OfficialSourceContent[]): StorableOfficialSourceContent | undefined {
  const preference: StorableOfficialSourceContent["contentType"][] = [
    "application/xml",
    "text/html",
    "text/plain"
  ];

  for (const contentType of preference) {
    const content = contents.find(
      (item): item is StorableOfficialSourceContent => item.language === "en" && item.contentType === contentType
    );

    if (content) {
      return content;
    }
  }

  return undefined;
}

function normalizeRetrievalFailure(cause: unknown) {
  if (cause instanceof RetrievalFailure) {
    return { code: cause.code, message: cause.message };
  }

  return { code: "RETRIEVAL_ERROR", message: "Official source content retrieval failed" };
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
