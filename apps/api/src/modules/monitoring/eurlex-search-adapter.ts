import type { WatchQuery } from "@sanctions/domain";
import { parseEurLexSearchResponse } from "./eurlex-search-parser.js";
import type { EurLexSearchAdapter, MonitorWindow, RawSearchResponse } from "./search-types.js";

export class EurLexSearchConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EurLexSearchConfigurationError";
  }
}

export class RecordedEurLexSearchAdapter implements EurLexSearchAdapter {
  constructor(private readonly fixtures: Record<string, RawSearchResponse>) {}

  async search(input: { watchQuery: WatchQuery; monitorWindow: MonitorWindow }) {
    const rawResponse = this.fixtures[input.watchQuery.id];

    if (!rawResponse) {
      throw new EurLexSearchConfigurationError(`Recorded EUR-Lex search fixture not found for ${input.watchQuery.id}`);
    }

    return {
      rawResponse,
      ...parseEurLexSearchResponse(rawResponse.body)
    };
  }
}

export interface LiveEurLexWebServiceSearchAdapterConfig {
  endpointUrl?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
}

interface RequiredLiveEurLexWebServiceSearchAdapterConfig {
  endpointUrl: string;
  username: string;
  password: string;
}

export class LiveEurLexWebServiceSearchAdapter implements EurLexSearchAdapter {
  constructor(private readonly config: LiveEurLexWebServiceSearchAdapterConfig) {}

  async search(input: { watchQuery: WatchQuery; monitorWindow: MonitorWindow }) {
    const config = requireLiveConfig(this.config);

    const body = buildSoapSearchEnvelope({
      queryText: input.watchQuery.queryText,
      username: config.username,
      password: config.password
    });
    const headers: Record<string, string> = {
      "content-type": "application/soap+xml; charset=utf-8"
    };

    const response = await fetch(config.endpointUrl, {
      method: "POST",
      headers,
      body
    });

    if (!response.ok) {
      throw new Error(`EUR-Lex Web Service search failed with status ${response.status}`);
    }

    const responseBody = await response.text();
    const rawResponse: RawSearchResponse = {
      contentType: "application/xml",
      sourceUri: config.endpointUrl,
      body: responseBody
    };

    return {
      rawResponse,
      ...parseEurLexSearchResponse(responseBody)
    };
  }
}

export const recordedEurLexSearchFixtures: Record<string, RawSearchResponse> = {
  "watch-query-269-rss": {
    contentType: "application/xml",
    sourceUri: "eurlex:recorded-search:watch-query-269-rss",
    body: `<?xml version="1.0" encoding="UTF-8"?>
<search-results>
  <result>
    <CELEX>32026R3001</CELEX>
    <CELLAR>cellar-32026r3001</CELLAR>
    <URI>https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R3001</URI>
    <TITLE>Council Implementing Regulation recorded search delta</TITLE>
    <DATE_PUBLICATION>2026-05-17</DATE_PUBLICATION>
    <URL>https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R3001</URL>
  </result>
  <result>
    <CELLAR>cellar-32026r3002</CELLAR>
    <URI>https://publications.europa.eu/resource/cellar/cellar-32026r3002</URI>
    <TITLE>Council Implementing Regulation recorded CELLAR-only search hit</TITLE>
    <DATE_PUBLICATION>2026-05-18</DATE_PUBLICATION>
  </result>
  <result>
    <TITLE>Malformed title-only search result</TITLE>
  </result>
</search-results>`
  }
};

function requireLiveConfig(config: LiveEurLexWebServiceSearchAdapterConfig): RequiredLiveEurLexWebServiceSearchAdapterConfig {
  if (!config.endpointUrl) {
    throw new EurLexSearchConfigurationError("EUR-Lex Web Service endpoint URL is required for live search");
  }

  if (!config.username || !config.password) {
    throw new EurLexSearchConfigurationError("EUR-Lex Web Service username and password are required for live search");
  }

  return {
    endpointUrl: config.endpointUrl,
    username: config.username,
    password: config.password
  };
}

function buildSoapSearchEnvelope(input: { queryText: string; username: string; password: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:sear="http://eur-lex.europa.eu/search" xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Header>
    <wsse:Security soap:mustUnderstand="true" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <wsse:Username>${escapeXml(input.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(input.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
    <sear:searchRequest>
      <sear:expertQuery>${escapeXml(input.queryText)}</sear:expertQuery>
      <sear:page>1</sear:page>
      <sear:pageSize>10</sear:pageSize>
      <sear:searchLanguage>en</sear:searchLanguage>
    </sear:searchRequest>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
