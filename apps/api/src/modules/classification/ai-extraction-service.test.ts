import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiExtractionConfigurationError,
  extractSanctionsDeltaRecordsWithAi,
  resolveAiProviderRequestConfig,
  selectAiSourceContent
} from "./ai-extraction-service.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI extraction source selection", () => {
  it("keeps the annex window when Source Content is too large for fast extraction", () => {
    const prefix = "preface ".repeat(20_000);
    const annex = "Annex I listed-entry changes begin here";
    const suffix = " sanction entry".repeat(20_000);

    const content = `${prefix}${annex}${suffix}`;
    const selected = selectAiSourceContent(content);

    expect(selected.length).toBeLessThanOrEqual(70_000);
    expect(selected).toContain(annex);
    expect(selected).not.toBe(content.slice(0, 70_000));
  });

  it("leaves already-small Source Content unchanged", () => {
    const content = "Official Journal source with Annex I";

    expect(selectAiSourceContent(content)).toBe(content);
  });
});

describe("AI extraction requests", () => {
  it("requests a larger output budget for structured extraction", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("AI_EXTRACTION_MAX_OUTPUT_TOKENS", "16000");
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            classification: "NO_DELTA",
            confidence: 0.9,
            annexFound: false,
            annexHeading: "",
            isComplete: true,
            evidenceSummary: "No listed-entry changes.",
            records: []
          })
        })
      } as Response;
    });

    const result = await extractSanctionsDeltaRecordsWithAi({
      candidate: {
        id: "candidate-ai-test",
        celexId: "32026R0001",
        legalActIdentityKind: "CELEX",
        legalActIdentityValue: "32026R0001",
        title: "AI test legal act",
        status: "CONTENT_RETRIEVED",
        workingLanguage: "en",
        detectedAt: "2026-05-27T12:00:00.000Z",
        lastSeenAt: "2026-05-27T12:00:00.000Z"
      },
      content: "Official source content without an annex.",
      createdAt: "2026-05-27T12:00:00.000Z",
      fetchImpl
    });

    expect(requestBody).toMatchObject({
      max_output_tokens: 16000
    });
    expect(result.extractionResult.aiCall).toMatchObject({
      provider: "openai",
      model: "gpt-5-mini",
      status: "unknown"
    });
  });

  it("captures token usage and estimated cost metadata from the provider response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("AI_EXTRACTION_MODEL", "gpt-5-mini");
    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          status: "completed",
          usage: {
            input_tokens: 10_000,
            input_tokens_details: {
              cached_tokens: 1_000
            },
            output_tokens: 500,
            output_tokens_details: {
              reasoning_tokens: 100
            },
            total_tokens: 10_500
          },
          output_text: JSON.stringify({
            classification: "NO_DELTA",
            confidence: 0.9,
            annexFound: false,
            isComplete: true,
            evidenceSummary: "No listed-entry changes.",
            records: []
          })
        })
      }) as Response
    );

    const result = await extractSanctionsDeltaRecordsWithAi({
      candidate: {
        id: "candidate-ai-test",
        celexId: "32026R0001",
        legalActIdentityKind: "CELEX",
        legalActIdentityValue: "32026R0001",
        title: "AI test legal act",
        status: "CONTENT_RETRIEVED",
        workingLanguage: "en",
        detectedAt: "2026-05-27T12:00:00.000Z",
        lastSeenAt: "2026-05-27T12:00:00.000Z"
      },
      content: "Official source content without an annex.",
      createdAt: "2026-05-27T12:00:00.000Z",
      fetchImpl
    });

    expect(result.extractionResult.aiCall).toMatchObject({
      provider: "openai",
      model: "gpt-5-mini",
      status: "completed",
      inputTokens: 10_000,
      cachedInputTokens: 1_000,
      outputTokens: 500,
      reasoningTokens: 100,
      totalTokens: 10_500,
      estimatedCostUsd: 0.003275
    });
  });

  it("does not persist legal provision amendments as listed entity records", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          status: "completed",
          output_text: JSON.stringify({
            classification: "DELTA",
            confidence: 0.94,
            annexFound: true,
            annexHeading: "Regulation (EU) No 269/2014 amendments",
            isComplete: true,
            evidenceSummary: "The act amends Articles 3, 4, 5c and 6b.",
            records: [
              {
                recordType: "ENTITY",
                actionType: "AMEND",
                primaryName: "Article 3(1) point (k) of Regulation (EU) No 269/2014",
                listedEntryFields: [
                  {
                    field: "name",
                    value: "Article 3(1) point (k) of Regulation (EU) No 269/2014"
                  }
                ],
                affectedAnnex: "",
                detectedBaseAct: "269/2014",
                sourceLocation: "Article 1(1)",
                evidenceText:
                  "in Article 3(1), point (k) is replaced by the following: natural or legal persons, entities or bodies...",
                confidence: 0.9
              },
              {
                recordType: "ENTITY",
                actionType: "AMEND",
                primaryName: "Article 6b of Regulation (EU) No 269/2014",
                listedEntryFields: [
                  {
                    field: "name",
                    value: "Article 6b of Regulation (EU) No 269/2014"
                  }
                ],
                affectedAnnex: "Annex I (entry numbers 56, 270, 579 and 726)",
                detectedBaseAct: "269/2014",
                sourceLocation: "Article 1(5)",
                evidenceText:
                  "By way of derogation from Article 2, the competent authorities may authorise the release of certain frozen funds belonging to the entity listed under entry number 639.",
                confidence: 0.88
              }
            ]
          })
        })
      }) as Response
    );

    const result = await extractSanctionsDeltaRecordsWithAi({
      candidate: {
        id: "candidate-32026r0511",
        celexId: "32026R0511",
        legalActIdentityKind: "CELEX",
        legalActIdentityValue: "32026R0511",
        title: "Council Regulation amending Regulation (EU) No 269/2014",
        status: "CONTENT_RETRIEVED",
        workingLanguage: "en",
        detectedAt: "2026-05-30T09:00:00.000Z",
        lastSeenAt: "2026-05-30T09:00:00.000Z"
      },
      content: "Regulation (EU) No 269/2014 is amended as follows: in Article 3(1), point (k) is replaced.",
      createdAt: "2026-05-30T09:00:00.000Z",
      fetchImpl
    });

    expect(result.records).toEqual([]);
    expect(result.extractionResult).toMatchObject({
      classification: "NO_DELTA",
      annexFound: false,
      isComplete: true
    });
    expect(result.candidate.status).toBe("NO_DELTA");
  });
});

describe("AI extraction provider configuration", () => {
  it("uses OpenAI Responses API by default", () => {
    expect(
      resolveAiProviderRequestConfig({
        OPENAI_API_KEY: "openai-key",
        AI_EXTRACTION_MODEL: "gpt-5-mini"
      })
    ).toMatchObject({
      provider: "openai",
      endpointUrl: "https://api.openai.com/v1/responses",
      headers: {
        authorization: "Bearer openai-key",
        "content-type": "application/json"
      },
      model: "gpt-5-mini",
      parserVersion: "openai-structured-extractor-v1"
    });
  });

  it("uses Azure OpenAI endpoint, API key, and configured model as the deployment name", () => {
    expect(
      resolveAiProviderRequestConfig({
        AI_EXTRACTION_PROVIDER: "azure-openai",
        AZURE_OPENAI_ENDPOINT: "https://sanctions-resource.openai.azure.com",
        AZURE_OPENAI_API_KEY: "azure-key",
        AI_EXTRACTION_MODEL: "sanctions-gpt-5-mini",
        AZURE_OPENAI_API_VERSION: "preview"
      })
    ).toMatchObject({
      provider: "azure-openai",
      endpointUrl:
        "https://sanctions-resource.openai.azure.com/openai/v1/responses?api-version=preview",
      headers: {
        "api-key": "azure-key",
        "content-type": "application/json"
      },
      model: "sanctions-gpt-5-mini",
      parserVersion: "azure-openai-structured-extractor-v1"
    });
  });

  it("keeps older provider-specific model variables as aliases", () => {
    expect(
      resolveAiProviderRequestConfig({
        AI_EXTRACTION_PROVIDER: "azure-openai",
        AZURE_OPENAI_ENDPOINT: "https://sanctions-resource.openai.azure.com",
        AZURE_OPENAI_API_KEY: "azure-key",
        AZURE_OPENAI_DEPLOYMENT: "legacy-deployment"
      }).model
    ).toBe("legacy-deployment");
  });

  it("omits older Azure inference preview API versions for the v1 Responses API", () => {
    expect(
      resolveAiProviderRequestConfig({
        AI_EXTRACTION_PROVIDER: "azure-openai",
        AZURE_OPENAI_ENDPOINT: "https://sanctions-resource.openai.azure.com",
        AZURE_OPENAI_API_KEY: "azure-key",
        AI_EXTRACTION_MODEL: "sanctions-gpt-5-mini",
        AZURE_OPENAI_API_VERSION: "2024-02-15-preview"
      }).endpointUrl
    ).toBe("https://sanctions-resource.openai.azure.com/openai/v1/responses");
  });

  it("accepts AZURE_OPENAI_KEY as an Azure API key alias", () => {
    expect(
      resolveAiProviderRequestConfig({
        AI_EXTRACTION_PROVIDER: "azure-openai",
        AZURE_OPENAI_ENDPOINT: "https://sanctions-resource.openai.azure.com",
        AZURE_OPENAI_KEY: "azure-key",
        AI_EXTRACTION_MODEL: "sanctions-gpt-5-mini"
      }).headers
    ).toMatchObject({
      "api-key": "azure-key"
    });
  });

  it("accepts Azure endpoints that already include the OpenAI v1 base path", () => {
    expect(
      resolveAiProviderRequestConfig({
        AI_EXTRACTION_PROVIDER: "azure-openai",
        AZURE_OPENAI_ENDPOINT: "https://sanctions-resource.openai.azure.com/openai/v1",
        AZURE_OPENAI_API_KEY: "azure-key",
        AI_EXTRACTION_MODEL: "sanctions-gpt-5-mini"
      }).endpointUrl
    ).toBe("https://sanctions-resource.openai.azure.com/openai/v1/responses");
  });
});
