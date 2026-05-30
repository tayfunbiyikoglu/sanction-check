import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../app.js";
import {
  auditEvents,
  candidateLegalActs,
  extractionResults,
  monitorRuns,
  sanctionsDeltaRecords,
  watchQueries
} from "../seed-data.js";
import { runAutomatedRssWorkflow } from "./rss-automation.js";

const originalCandidates = structuredClone(candidateLegalActs);
const originalMonitorRuns = structuredClone(monitorRuns);
const originalDeltaRecords = structuredClone(sanctionsDeltaRecords);
const originalExtractionResults = structuredClone(extractionResults);
const originalWatchQueries = structuredClone(watchQueries);

describe("RSS automation workflow", () => {
  let sourceContentRoot: string | undefined;

  beforeEach(async () => {
    restore(candidateLegalActs, originalCandidates);
    restore(monitorRuns, originalMonitorRuns);
    restore(sanctionsDeltaRecords, originalDeltaRecords);
    restore(extractionResults, originalExtractionResults);
    restore(watchQueries, originalWatchQueries);
    auditEvents.splice(0);
    sourceContentRoot = await mkdtemp(path.join(tmpdir(), "source-content-"));
    process.env.SOURCE_CONTENT_STORAGE_DIR = sourceContentRoot;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.SOURCE_CONTENT_STORAGE_DIR;
    delete process.env.CELLAR_RETRIEVAL_MODE;

    if (sourceContentRoot) {
      await rm(sourceContentRoot, { recursive: true, force: true });
    }
  });

  it("runs all RSS watch queries, then retrieves and extracts newly discovered candidates", async () => {
    const annexFixture = await readFile(
      path.resolve(import.meta.dirname, "../parser/fixtures/annex-delta-records.xml"),
      "utf8"
    );
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      const accept = headerValue(init?.headers, "accept");

      if (url === "https://eur-lex.europa.eu/feed.rss") {
        return {
          ok: true,
          status: 200,
          url,
          text: async () => `
            <rss version="2.0">
              <channel>
                <item>
                  <title>Automated RSS legal act</title>
                  <link>https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R7101</link>
                  <guid>CELEX:32026R7101</guid>
                  <pubDate>18 May 2026</pubDate>
                </item>
              </channel>
            </rss>
          `
        };
      }

      if (url === "https://publications.europa.eu/resource/celex/32026R7101") {
        if (accept === "application/xhtml+xml") {
          return {
            ok: false,
            status: 404,
            url,
            text: async () => ""
          };
        }

        return {
          ok: true,
          status: 200,
          url,
          text: async () => annexFixture
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    watchQueries.splice(0, watchQueries.length, {
      ...watchQueries[0]!,
      feedUrl: "https://eur-lex.europa.eu/feed.rss"
    });
    const server = buildServer();

    const result = await runAutomatedRssWorkflow(server, {
      publicationYear: 2026,
      retrievalMode: "live"
    });

    expect(result).toMatchObject({
      watchQueryCount: 1,
      itemsSeen: 1,
      newCandidates: 1,
      processedCandidates: [
        {
          candidateId: "candidate-discovered-32026r7101",
          retrievalStatus: "CONTENT_RETRIEVED",
          extractionStatus: "COMPLETED"
        }
      ],
      errors: []
    });
    expect(candidateLegalActs.find((candidate) => candidate.celexId === "32026R7101")).toMatchObject({
      status: "NEEDS_EXTRACTION_CORRECTION",
      sourceContent: {
        contentType: "application/xml"
      }
    });
    expect(extractionResults.some((result) => result.candidateId === "candidate-discovered-32026r7101")).toBe(true);
  });
});

function restore<T>(target: T[], source: T[]): void {
  target.splice(0, target.length, ...structuredClone(source));
}

function headerValue(headers: RequestInit["headers"], key: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return headers.get(key) ?? undefined;
  }

  if (Array.isArray(headers)) {
    return headers.find(([name]) => name.toLowerCase() === key)?.[1];
  }

  return headers[key];
}
