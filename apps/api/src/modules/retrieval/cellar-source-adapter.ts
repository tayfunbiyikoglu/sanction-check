import type { CandidateLegalAct } from "@sanctions/domain";
import { resolveLegalActIdentity } from "@sanctions/domain";
import { RetrievalFailure } from "./mock-eurlex-cellar-adapter.js";
import type { OfficialSourceAdapter, OfficialSourceLookup } from "./types.js";

export interface LiveCellarSourceContentAdapterConfig {
  endpointUrl?: string | undefined;
  apiKey?: string | undefined;
}

export class RecordedCellarSourceContentAdapter implements OfficialSourceAdapter {
  private readonly fixtures: Map<string, OfficialSourceLookup | RetrievalFailure>;

  constructor(fixtures: Record<string, OfficialSourceLookup | RetrievalFailure>) {
    this.fixtures = new Map(Object.entries(fixtures));
  }

  async retrieve(candidate: CandidateLegalAct): Promise<OfficialSourceLookup> {
    for (const key of candidateIdentityLookupKeys(candidate)) {
      const fixture = this.fixtures.get(key);

      if (fixture instanceof RetrievalFailure) {
        throw fixture;
      }

      if (fixture) {
        return fixture;
      }
    }

    throw new RetrievalFailure("SOURCE_NOT_FOUND", "Official source content was not found");
  }
}

export class LiveCellarSourceContentAdapter implements OfficialSourceAdapter {
  constructor(private readonly config: LiveCellarSourceContentAdapterConfig) {}

  async retrieve(candidate: CandidateLegalAct): Promise<OfficialSourceLookup> {
    if (!this.config.endpointUrl) {
      throw new RetrievalFailure("CELLAR_CONFIG_MISSING", "CELLAR endpoint URL is required for live retrieval");
    }

    const sourceUrl = buildCellarResourceUrl(this.config.endpointUrl, candidate);
    const htmlContent = await retrieveTextContent(sourceUrl, {
      accept: "application/xhtml+xml",
      language: "eng",
      apiKey: this.config.apiKey
    });

    if (htmlContent) {
      return {
        availableLanguages: ["en"],
        contents: [
          {
            language: "en",
            contentType: "text/html",
            sourceUri: htmlContent.sourceUri,
            body: htmlContent.body
          }
        ]
      };
    }

    const branchNotice = await retrieveTextContent(sourceUrl, {
      accept: "application/xml;notice=branch",
      language: "eng",
      apiKey: this.config.apiKey
    });

    if (branchNotice) {
      return {
        availableLanguages: ["en"],
        contents: [
          {
            language: "en",
            contentType: "application/xml",
            sourceUri: branchNotice.sourceUri,
            body: branchNotice.body
          }
        ]
      };
    }

    throw new RetrievalFailure("SOURCE_NOT_FOUND", "English CELLAR source content was not found");
  }
}

export function candidateIdentityLookupKeys(candidate: CandidateLegalAct): string[] {
  return [candidate.celexId, candidate.cellarId, candidate.officialUri, candidate.id].filter(
    (key): key is string => Boolean(key)
  );
}

function buildCellarResourceUrl(endpointUrl: string, candidate: CandidateLegalAct): URL {
  const normalizedEndpoint = endpointUrl.endsWith("/") ? endpointUrl : `${endpointUrl}/`;
  const identity = resolveLegalActIdentity(candidate);

  if (identity.kind === "CELEX") {
    return new URL(`celex/${encodeURIComponent(identity.value)}`, normalizedEndpoint);
  }

  if (identity.kind === "CELLAR") {
    return new URL(`cellar/${encodeURIComponent(identity.value)}`, normalizedEndpoint);
  }

  return new URL(identity.value);
}

async function retrieveTextContent(
  url: URL,
  input: { accept: string; language: "eng"; apiKey?: string | undefined }
): Promise<{ sourceUri: string; body: string } | undefined> {
  const headers: Record<string, string> = {
    accept: input.accept,
    "accept-language": input.language
  };

  if (input.apiKey) {
    headers.authorization = `Bearer ${input.apiKey}`;
  }

  const response = await fetch(url, {
    headers,
    redirect: "follow"
  });

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new RetrievalFailure("CELLAR_RETRIEVAL_FAILED", `CELLAR retrieval failed with status ${response.status}`);
  }

  return {
    sourceUri: response.url,
    body: await response.text()
  };
}
