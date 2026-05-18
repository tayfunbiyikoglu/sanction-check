import type { SearchResponseReference, SourceContentReference, WatchQuery } from "@sanctions/domain";
import { describe, expect, it } from "vitest";
import {
  buildSafeCellarSmokeReport,
  buildSafeRssSmokeReport,
  buildSafeSearchSmokeReport,
  requireLiveSmokeOptIn
} from "./smoke-report.js";

describe("live integration smoke reports", () => {
  it("reports safe search counts, identities, and immutable search response metadata", () => {
    const watchQuery: WatchQuery = {
      id: "watch-query-269-rss",
      name: "Regulation 269/2014 RSS overlap monitor",
      source: "EURLEX_WS",
      queryText: "MS=32014R0269 ORDER BY XC DESC",
      isActive: true,
      createdAt: "2026-05-17T08:00:00.000Z",
      configuredBaseActIds: ["base-act-269-2014"]
    };
    const searchResponse: SearchResponseReference = {
      reference: "sha256/ab/abcdef.xml",
      contentHash: "abcdef",
      contentLength: 1234,
      contentType: "application/xml",
      sourceUri: "https://eur-lex.example.test/search",
      retrievedAt: "2026-05-17T08:00:00.000Z"
    };

    const report = buildSafeSearchSmokeReport({
      watchQuery,
      searchResponse,
      triggers: [
        {
          celexId: "32026R4001",
          title: "Council Implementing Regulation test result",
          sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R4001"
        }
      ],
      errors: ["Search result 2 has no Legal Act Identity"]
    });

    expect(report).toEqual({
      ok: true,
      watchQueryId: "watch-query-269-rss",
      discoveryTriggerCount: 1,
      malformedTriggerErrorCount: 1,
      legalActIdentities: [{ kind: "CELEX", value: "32026R4001" }],
      searchResponse
    });
    expect(JSON.stringify(report)).not.toContain("primaryName");
    expect(JSON.stringify(report)).not.toContain("evidenceText");
  });

  it("reports safe CELLAR retrieval metadata without Source Content bytes", () => {
    const sourceContent: SourceContentReference = {
      reference: "sha256/cd/cdef.xml",
      contentHash: "cdef",
      contentLength: 4321,
      contentType: "application/xml",
      language: "en",
      sourceUri: "https://publications.europa.eu/resource/cellar/example",
      retrievedAt: "2026-05-17T08:00:00.000Z"
    };

    const report = buildSafeCellarSmokeReport({
      availableLanguageCount: 3,
      sourceContent,
      candidate: {
        id: "candidate-smoke-32014R0269",
        celexId: "32014R0269",
        title: "Council Regulation smoke candidate",
        status: "CONTENT_RETRIEVED",
        workingLanguage: "en",
        detectedAt: "2026-05-17T08:00:00.000Z",
        lastSeenAt: "2026-05-17T08:00:00.000Z",
        retrieval: {
          status: "CONTENT_RETRIEVED",
          attempts: 1,
          availableLanguages: ["en", "fr", "de"]
        },
        sourceContent
      }
    });

    expect(report).toEqual({
      ok: true,
      candidateId: "candidate-smoke-32014R0269",
      legalActIdentity: { kind: "CELEX", value: "32014R0269" },
      retrievalStatus: "CONTENT_RETRIEVED",
      failureCode: undefined,
      availableLanguageCount: 3,
      sourceContent
    });
    expect(JSON.stringify(report)).not.toContain("<");
  });

  it("requires explicit live smoke opt-in", () => {
    expect(requireLiveSmokeOptIn({})).toMatchObject({
      ok: false,
      skipped: true
    });
    expect(requireLiveSmokeOptIn({ RUN_LIVE_EURLEX_SMOKE: "1" })).toBeUndefined();
  });

  it("reports safe RSS trigger counts and legal act identities", () => {
    const watchQuery: WatchQuery = {
      id: "watch-query-269-rss",
      name: "Regulation 269/2014 RSS overlap monitor",
      source: "RSS",
      queryText: "RSS feed URL",
      isActive: true,
      createdAt: "2026-05-17T08:00:00.000Z",
      configuredBaseActIds: ["base-act-269-2014"]
    };

    const report = buildSafeRssSmokeReport({
      watchQuery,
      feedUrl: "https://eur-lex.europa.eu/feed.rss",
      triggers: [
        {
          celexId: "32026R7001",
          title: "Council Implementing Regulation sample"
        }
      ],
      errors: ["RSS item 2 has no Legal Act Identity"]
    });

    expect(report).toEqual({
      ok: true,
      watchQueryId: "watch-query-269-rss",
      feedUrl: "https://eur-lex.europa.eu/feed.rss",
      discoveryTriggerCount: 1,
      malformedTriggerErrorCount: 1,
      legalActIdentities: [{ kind: "CELEX", value: "32026R7001" }]
    });
  });
});
