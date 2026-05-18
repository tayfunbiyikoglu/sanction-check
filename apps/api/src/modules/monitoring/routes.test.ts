import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../app.js";
import { auditEvents, candidateLegalActs, monitorRuns, sanctionsDeltaRecords, watchQueries } from "../seed-data.js";

const originalCandidates = structuredClone(candidateLegalActs);
const originalMonitorRuns = structuredClone(monitorRuns);
const originalDeltaRecords = structuredClone(sanctionsDeltaRecords);
const originalWatchQueries = structuredClone(watchQueries);

describe("monitoring routes", () => {
  let searchResponseRoot: string | undefined;

  beforeEach(async () => {
    restore(candidateLegalActs, originalCandidates);
    restore(monitorRuns, originalMonitorRuns);
    restore(sanctionsDeltaRecords, originalDeltaRecords);
    restore(watchQueries, originalWatchQueries);
    auditEvents.splice(0);
    searchResponseRoot = await mkdtemp(path.join(tmpdir(), "search-response-"));
    process.env.SEARCH_RESPONSE_STORAGE_DIR = searchResponseRoot;
  });

  afterEach(async () => {
    delete process.env.SEARCH_RESPONSE_STORAGE_DIR;
    delete process.env.EURLEX_SEARCH_MODE;
    delete process.env.EURLEX_WEBSERVICE_URL;
    delete process.env.EURLEX_RSS_FEED_URL;
    delete process.env.CELLAR_RETRIEVAL_MODE;
    vi.unstubAllGlobals();
    if (searchResponseRoot) {
      await rm(searchResponseRoot, { recursive: true, force: true });
    }
  });

  it("records monitor run results and exposes deduplicated candidates", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/monitoring/runs",
      payload: {
        watchQueryId: watchQueries[0]!.id,
        startedAt: "2026-05-17T13:00:00.000Z",
        finishedAt: "2026-05-17T13:00:02.000Z",
        triggers: [
          {
            celexId: "32026R3001",
            officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R3001",
            title: "Initial RSS discovery trigger"
          },
          {
            celexId: "32026R3001",
            officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R3001",
            title: "Repeated RSS discovery trigger"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      monitorRun: {
        status: "SUCCESS",
        itemsSeen: 2,
        newCandidates: 1,
        querySnapshot: watchQueries[0]!.queryText
      },
      candidates: [
        {
          celexId: "32026R3001",
          legalActIdentityKind: "CELEX",
          legalActIdentityValue: "32026R3001"
        },
        {
          celexId: "32026R3001",
          legalActIdentityKind: "CELEX",
          legalActIdentityValue: "32026R3001"
        }
      ],
      errors: []
    });

    const runsResponse = await server.inject({ method: "GET", url: "/monitoring/runs" });
    expect(runsResponse.json().monitorRuns[0]).toMatchObject({
      itemsSeen: 2,
      newCandidates: 1
    });

    const candidatesResponse = await server.inject({ method: "GET", url: "/candidates" });
    const matches = candidatesResponse
      .json()
      .candidates.filter((candidate: { celexId?: string }) => candidate.celexId === "32026R3001");

    expect(matches).toHaveLength(1);
    expect(sanctionsDeltaRecords).toHaveLength(0);
  });

  it("runs recorded EUR-Lex search, stores Search Response Reference, and delegates candidate merging", async () => {
    process.env.CELLAR_RETRIEVAL_MODE = "live";
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/monitoring/search-runs",
      payload: {
        watchQueryId: watchQueries[0]!.id,
        startedAt: "2026-05-17T14:00:00.000Z",
        finishedAt: "2026-05-17T14:00:02.000Z"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      monitorRun: {
        status: "PARTIAL",
        itemsSeen: 3,
        newCandidates: 2,
        querySnapshot: watchQueries[0]!.queryText,
        searchResponse: {
          contentType: "application/xml",
          contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          reference: expect.stringMatching(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.xml$/)
        }
      },
      candidates: [
        {
          celexId: "32026R3001",
          legalActIdentityKind: "CELEX"
        },
        {
          cellarId: "cellar-32026r3002",
          legalActIdentityKind: "CELLAR"
        }
      ],
      errors: ["Search result 3 has no Legal Act Identity"],
      searchResponse: {
        contentLength: expect.any(Number)
      }
    });

    const runsResponse = await server.inject({ method: "GET", url: "/monitoring/runs" });
    expect(runsResponse.json().monitorRuns[0].searchResponse.reference).toBe(response.json().searchResponse.reference);
    expect(auditEvents[0]).toMatchObject({
      type: "MONITOR_RUN_RECORDED",
      payload: {
        searchResponseReference: response.json().searchResponse.reference,
        errorCount: 1
      }
    });
    expect(sanctionsDeltaRecords).toHaveLength(0);
  });

  it("fails live EUR-Lex search clearly when live configuration is missing", async () => {
    process.env.EURLEX_SEARCH_MODE = "live";
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/monitoring/search-runs",
      payload: {
        watchQueryId: watchQueries[0]!.id
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: "EUR-Lex Web Service endpoint URL is required for live search"
    });
  });

  it("runs a live RSS feed URL and delegates candidate merging without creating delta records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://eur-lex.europa.eu/feed.rss",
        text: async () => `
          <rss version="2.0">
            <channel>
              <item>
                <title>Council Implementing Regulation from RSS</title>
                <link>https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R7001</link>
                <guid>CELEX:32026R7001</guid>
              </item>
              <item>
                <title>Malformed RSS item</title>
              </item>
            </channel>
          </rss>
        `
      }))
    );
    const server = buildServer();

    const response = await server.inject({
      method: "POST",
      url: "/monitoring/rss-runs",
      payload: {
        watchQueryId: watchQueries[0]!.id,
        feedUrl: "https://eur-lex.europa.eu/feed.rss",
        startedAt: "2026-05-17T15:00:00.000Z",
        finishedAt: "2026-05-17T15:00:02.000Z"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      monitorRun: {
        status: "PARTIAL",
        source: "RSS",
        itemsSeen: 2,
        newCandidates: 1
      },
      candidates: [
        {
          celexId: "32026R7001",
          legalActIdentityKind: "CELEX"
        }
      ],
      errors: ["RSS item 2 has no Legal Act Identity"],
      feed: {
        url: "https://eur-lex.europa.eu/feed.rss",
        contentLength: expect.any(Number)
      }
    });
    expect(auditEvents[0]).toMatchObject({
      type: "MONITOR_RUN_RECORDED",
      payload: {
        source: "RSS",
        feedUrl: "https://eur-lex.europa.eu/feed.rss",
        errorCount: 1
      }
    });
    expect(sanctionsDeltaRecords).toHaveLength(0);
  });

  it("filters live RSS candidates to the requested publication year before merging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://eur-lex.europa.eu/feed.rss",
        text: async () => `
          <rss version="2.0">
            <channel>
              <item>
                <title>Current year RSS legal act</title>
                <link>https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R7002</link>
                <guid>CELEX:32026R7002</guid>
                <pubDate>18 May 2026</pubDate>
              </item>
              <item>
                <title>Old RSS legal act</title>
                <link>https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32025R7003</link>
                <guid>CELEX:32025R7003</guid>
                <pubDate>18 May 2025</pubDate>
              </item>
            </channel>
          </rss>
        `
      }))
    );
    const server = buildServer();

    const response = await server.inject({
      method: "POST",
      url: "/monitoring/rss-runs",
      payload: {
        watchQueryId: watchQueries[0]!.id,
        feedUrl: "https://eur-lex.europa.eu/feed.rss",
        publicationYear: 2026,
        startedAt: "2026-05-18T15:00:00.000Z",
        finishedAt: "2026-05-18T15:00:02.000Z"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      monitorRun: {
        status: "SUCCESS",
        itemsSeen: 2,
        newCandidates: 1
      },
      candidates: [
        {
          celexId: "32026R7002",
          publicationDate: "2026-05-18"
        }
      ],
      errors: [],
      feed: {
        publicationYear: 2026,
        filteredOut: 1
      }
    });

    const candidatesResponse = await server.inject({ method: "GET", url: "/candidates" });
    const celexIds = candidatesResponse.json().candidates.map((candidate: { celexId?: string }) => candidate.celexId);

    expect(celexIds).toContain("32026R7002");
    expect(celexIds).not.toContain("32025R7003");
  });

  it("fails RSS monitoring clearly when feed URL configuration is missing", async () => {
    delete watchQueries[0]!.feedUrl;
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/monitoring/rss-runs",
      payload: {
        watchQueryId: watchQueries[0]!.id
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: "EUR-Lex RSS feed URL is required for live RSS monitoring"
    });
  });
});

function restore<T>(target: T[], source: T[]): void {
  target.splice(0, target.length, ...structuredClone(source));
}
