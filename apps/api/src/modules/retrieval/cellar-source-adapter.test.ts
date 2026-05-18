import type { CandidateLegalAct } from "@sanctions/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetrievalFailure } from "./mock-eurlex-cellar-adapter.js";
import {
  candidateIdentityLookupKeys,
  LiveCellarSourceContentAdapter,
  RecordedCellarSourceContentAdapter
} from "./cellar-source-adapter.js";

describe("CELLAR Source Content adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves recorded Source Content by best available Legal Act Identity", async () => {
    const adapter = new RecordedCellarSourceContentAdapter({
      "32026R5001": {
        availableLanguages: ["en"],
        contents: [
          {
            language: "en",
            contentType: "application/xml",
            sourceUri: "cellar:recorded:32026R5001/en/xml",
            body: "<legalAct />"
          }
        ]
      }
    });

    const lookup = await adapter.retrieve(candidate({ celexId: "32026R5001", cellarId: "cellar-5001" }));

    expect(lookup).toMatchObject({
      availableLanguages: ["en"],
      contents: [
        {
          sourceUri: "cellar:recorded:32026R5001/en/xml"
        }
      ]
    });
  });

  it("falls back from CELEX to CELLAR to official document URI", async () => {
    const adapter = new RecordedCellarSourceContentAdapter({
      "cellar-5002": {
        availableLanguages: ["en"],
        contents: [
          {
            language: "en",
            contentType: "text/html",
            sourceUri: "cellar:recorded:cellar-5002/en/html",
            body: "<html></html>"
          }
        ]
      }
    });

    const lookup = await adapter.retrieve(candidate({ cellarId: "cellar-5002" }));

    expect(lookup.contents[0]).toMatchObject({
      sourceUri: "cellar:recorded:cellar-5002/en/html"
    });
    expect(candidateIdentityLookupKeys(candidate({ officialUri: "https://example.test/legal-act" }))).toEqual([
      "https://example.test/legal-act",
      "candidate-test"
    ]);
  });

  it("surfaces recorded retrieval failures as safe operational errors", async () => {
    const adapter = new RecordedCellarSourceContentAdapter({
      "32026R5003": new RetrievalFailure("CELLAR_UNAVAILABLE", "CELLAR retrieval failed")
    });

    await expect(adapter.retrieve(candidate({ celexId: "32026R5003" }))).rejects.toMatchObject({
      code: "CELLAR_UNAVAILABLE",
      message: "CELLAR retrieval failed"
    });
  });

  it("retrieves live English XHTML content through the public CELLAR resource endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: "https://publications.europa.eu/resource/cellar/example.0006.03/DOC_1",
      text: async () => "<?xml version=\"1.0\"?><html><body>Official English content</body></html>"
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveCellarSourceContentAdapter({
      endpointUrl: "https://publications.europa.eu/resource/"
    });

    const lookup = await adapter.retrieve(candidate({ celexId: "32014R0269" }));

    expect(fetchMock).toHaveBeenCalledWith(new URL("https://publications.europa.eu/resource/celex/32014R0269"), {
      headers: {
        accept: "application/xhtml+xml",
        "accept-language": "eng"
      },
      redirect: "follow"
    });
    expect(lookup).toEqual({
      availableLanguages: ["en"],
      contents: [
        {
          language: "en",
          contentType: "text/html",
          sourceUri: "https://publications.europa.eu/resource/cellar/example.0006.03/DOC_1",
          body: "<?xml version=\"1.0\"?><html><body>Official English content</body></html>"
        }
      ]
    });
  });

  it("falls back to a CELLAR branch notice when English XHTML content is not available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        url: "https://publications.europa.eu/resource/celex/32014R0269",
        text: async () => "not found"
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: "https://publications.europa.eu/resource/cellar/example/xml/branch?decoding=en",
        text: async () => "<?xml version=\"1.0\"?><NOTICE decoding=\"eng\" type=\"branch\" />"
      });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveCellarSourceContentAdapter({
      endpointUrl: "https://publications.europa.eu/resource"
    });

    const lookup = await adapter.retrieve(candidate({ celexId: "32014R0269" }));

    expect(fetchMock).toHaveBeenLastCalledWith(new URL("https://publications.europa.eu/resource/celex/32014R0269"), {
      headers: {
        accept: "application/xml;notice=branch",
        "accept-language": "eng"
      },
      redirect: "follow"
    });
    expect(lookup.contents[0]).toMatchObject({
      language: "en",
      contentType: "application/xml",
      sourceUri: "https://publications.europa.eu/resource/cellar/example/xml/branch?decoding=en"
    });
  });
});

function candidate(overrides: Partial<CandidateLegalAct>): CandidateLegalAct {
  return {
    id: "candidate-test",
    title: "Council Implementing Regulation test",
    status: "DETECTED",
    workingLanguage: "en",
    detectedAt: "2026-05-17T08:00:00.000Z",
    lastSeenAt: "2026-05-17T08:00:00.000Z",
    ...overrides
  };
}
