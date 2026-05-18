import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CandidateLegalAct } from "@sanctions/domain";
import { afterEach, describe, expect, it } from "vitest";
import { MockEurLexCellarAdapter, RetrievalFailure } from "./mock-eurlex-cellar-adapter.js";
import { FilesystemSourceContentRepository } from "./source-content-repository.js";
import { SourceRetrievalService } from "./source-retrieval-service.js";

const fixedNow = new Date("2026-05-17T09:00:00.000Z");
const tempRoots: string[] = [];

describe("SourceRetrievalService", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("selects official English source content and stores it by immutable hash reference", async () => {
    const service = await buildService({
      "32026R2001": {
        availableLanguages: ["fr", "en"],
        contents: [
          {
            language: "fr",
            contentType: "application/xml",
            sourceUri: "cellar:mock:32026R2001/fr/xml",
            body: "<acte>French content is not used</acte>"
          },
          {
            language: "en",
            contentType: "application/xml",
            sourceUri: "cellar:mock:32026R2001/en/xml",
            body: "<legalAct><annex>Official English Annex content</annex></legalAct>"
          }
        ]
      }
    });

    const retrieved = await service.retrieveEnglishSourceContent(candidate("32026R2001"));

    expect(retrieved.status).toBe("CONTENT_RETRIEVED");
    expect(retrieved.retrieval).toEqual({
      status: "CONTENT_RETRIEVED",
      attempts: 1,
      lastAttemptAt: fixedNow.toISOString(),
      availableLanguages: ["fr", "en"]
    });
    expect(retrieved.sourceContent).toMatchObject({
      reference: expect.stringMatching(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.xml$/),
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      contentType: "application/xml",
      contentLength: 66,
      language: "en",
      sourceUri: "cellar:mock:32026R2001/en/xml",
      retrievedAt: fixedNow.toISOString()
    });
    expect(retrieved.sourceContent?.reference).toContain(retrieved.sourceContent?.contentHash ?? "");
  });

  it("prefers English XML over HTML, plain text, and PDF manifestations", async () => {
    const service = await buildService({
      "32026R2006": {
        availableLanguages: ["en"],
        contents: [
          {
            language: "en",
            contentType: "application/pdf",
            sourceUri: "cellar:mock:32026R2006/en/pdf",
            body: "PDF bytes are not MVP Source Content"
          },
          {
            language: "en",
            contentType: "text/html",
            sourceUri: "cellar:mock:32026R2006/en/html",
            body: "<html><body>English HTML manifestation</body></html>"
          },
          {
            language: "en",
            contentType: "application/xml",
            sourceUri: "cellar:mock:32026R2006/en/xml",
            body: "<legalAct><annex>English XML manifestation</annex></legalAct>"
          },
          {
            language: "en",
            contentType: "text/plain",
            sourceUri: "cellar:mock:32026R2006/en/text",
            body: "English plain text manifestation"
          }
        ]
      }
    });

    const retrieved = await service.retrieveEnglishSourceContent(candidate("32026R2006"));

    expect(retrieved.status).toBe("CONTENT_RETRIEVED");
    expect(retrieved.sourceContent).toMatchObject({
      contentType: "application/xml",
      sourceUri: "cellar:mock:32026R2006/en/xml"
    });
  });

  it("marks the candidate legal act language pending when English source content is unavailable", async () => {
    const service = await buildService({
      "32026R2002": {
        availableLanguages: ["fr", "de"],
        contents: [
          {
            language: "fr",
            contentType: "text/html",
            sourceUri: "cellar:mock:32026R2002/fr/html",
            body: "<html lang=\"fr\"></html>"
          }
        ]
      }
    });

    const retrieved = await service.retrieveEnglishSourceContent(candidate("32026R2002"));

    expect(retrieved.status).toBe("LANGUAGE_PENDING");
    expect(retrieved.sourceContent).toBeUndefined();
    expect(retrieved.retrieval).toEqual({
      status: "LANGUAGE_PENDING",
      attempts: 1,
      lastAttemptAt: fixedNow.toISOString(),
      nextRetryAt: "2026-05-17T09:30:00.000Z",
      availableLanguages: ["fr", "de"]
    });
  });

  it("advances to a new immutable Source Content reference when official content changes", async () => {
    const service = await buildService({
      "32026R2007": {
        availableLanguages: ["en"],
        contents: [
          {
            language: "en",
            contentType: "application/xml",
            sourceUri: "cellar:mock:32026R2007/en/xml",
            body: "<legalAct><annex>Updated English Annex content</annex></legalAct>"
          }
        ]
      }
    });
    const existingCandidate = {
      ...candidate("32026R2007"),
      status: "EXTRACTED_COMPLETE" as const,
      sourceContent: {
        reference: "sha256/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.xml",
        contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        contentLength: 42,
        contentType: "application/xml" as const,
        language: "en" as const,
        sourceUri: "cellar:mock:32026R2007/en/xml",
        retrievedAt: "2026-05-16T09:00:00.000Z"
      }
    };

    const retrieved = await service.retrieveEnglishSourceContent(existingCandidate);

    expect(retrieved.status).toBe("CONTENT_RETRIEVED");
    expect(retrieved.sourceContent?.contentHash).not.toBe(existingCandidate.sourceContent.contentHash);
    expect(retrieved.retrieval).toMatchObject({
      status: "CONTENT_RETRIEVED",
      sourceContentChanged: true,
      previousSourceContentHash: existingCandidate.sourceContent.contentHash
    });
  });

  it("represents retrieval failure with safe operational metadata only", async () => {
    const service = await buildService({
      "32026R2003": new RetrievalFailure("CELLAR_UNAVAILABLE", "CELLAR retrieval failed")
    });

    const retrieved = await service.retrieveEnglishSourceContent(candidate("32026R2003"));

    expect(retrieved.status).toBe("FAILED_RETRIEVAL");
    expect(retrieved.sourceContent).toBeUndefined();
    expect(retrieved.retrieval).toEqual({
      status: "FAILED_RETRIEVAL",
      attempts: 1,
      lastAttemptAt: fixedNow.toISOString(),
      nextRetryAt: "2026-05-17T09:30:00.000Z",
      failureCode: "CELLAR_UNAVAILABLE",
      failureMessage: "CELLAR retrieval failed"
    });
  });
});

async function buildService(fixtures: ConstructorParameters<typeof MockEurLexCellarAdapter>[0]) {
  const root = await mkdtemp(path.join(tmpdir(), "source-content-"));
  tempRoots.push(root);

  return new SourceRetrievalService(
    new MockEurLexCellarAdapter(fixtures),
    new FilesystemSourceContentRepository(root),
    { now: () => fixedNow }
  );
}

function candidate(celexId: string): CandidateLegalAct {
  return {
    id: `candidate-${celexId}`,
    celexId,
    officialUri: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${celexId}`,
    title: "Council Implementing Regulation sample",
    status: "DETECTED",
    workingLanguage: "en",
    detectedAt: "2026-05-17T08:00:00.000Z",
    lastSeenAt: "2026-05-17T08:00:00.000Z"
  };
}
