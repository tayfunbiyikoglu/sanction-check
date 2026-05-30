import { randomUUID } from "node:crypto";
import type { AiCallMetadata, CandidateLegalAct, ExtractionResult, SanctionsDeltaRecord } from "@sanctions/domain";

const defaultModel = "gpt-5-mini";
const defaultProvider = "openai";
const defaultMaxOutputTokens = 12_000;
const maxSourceCharacters = 70_000;

export class AiExtractionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiExtractionConfigurationError";
  }
}

export class AiExtractionProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiExtractionProviderError";
  }
}

export interface AiExtractionResult {
  candidate: CandidateLegalAct;
  extractionResult: ExtractionResult;
  records: SanctionsDeltaRecord[];
}

interface OpenAiExtractionResponse {
  classification: "DELTA" | "NO_DELTA" | "UNCERTAIN_NO_DELTA" | "PARSING_FAILED";
  confidence: number;
  annexFound: boolean;
  annexHeading?: string;
  isComplete: boolean;
  evidenceSummary?: string;
  records: Array<{
    recordType: "PERSON" | "ENTITY";
    actionType: "ADD" | "AMEND" | "REMOVE" | "REPLACE";
    primaryName: string;
    listedEntryFields: Array<{ field: string; value: string }>;
    affectedAnnex?: string;
    detectedBaseAct?: string;
    sourceLocation?: string;
    evidenceText: string;
    confidence: number;
  }>;
}

interface ResponsesApiPayload {
  status?: string;
  incomplete_details?: unknown;
  usage?: unknown;
  output_text?: string;
  output?: unknown;
}

type AiExtractionProvider = "openai" | "azure-openai";

interface AiProviderRequestConfig {
  provider: AiExtractionProvider;
  endpointUrl: string;
  headers: Record<string, string>;
  model: string;
  parserVersion: string;
  providerLabel: string;
}

export async function extractSanctionsDeltaRecordsWithAi(input: {
  candidate: CandidateLegalAct;
  content: string;
  createdAt: string;
  fetchImpl?: typeof fetch;
}): Promise<AiExtractionResult> {
  const providerConfig = resolveAiProviderRequestConfig();
  const fetcher = input.fetchImpl ?? fetch;
  const startedAt = Date.now();
  const response = await fetcher(providerConfig.endpointUrl, {
    method: "POST",
    headers: providerConfig.headers,
    body: JSON.stringify({
      model: providerConfig.model,
      instructions: [
        "You extract EU sanctions-list changes from official EUR-Lex/CELLAR Source Content.",
        "Return only records that are explicitly supported by evidence text in the supplied source.",
        "A record is valid only when it is an actual listed natural person, legal person, entity, body, vessel, or organisation whose Annex/list entry is added, amended, removed, or replaced.",
        "Do not create records for legal provisions, article numbers, designation criteria, derogations, exemptions, definitions, prohibitions, claims clauses, or references to existing entry numbers.",
        "If a legal act only amends articles or derogations and does not amend an actual listed entry name/details in an Annex/list, return NO_DELTA with an empty records array.",
        "The primaryName must be the name of the listed person/entity itself, never an Article, paragraph, point, Regulation, Council act, Annex heading, entry number, or legal provision.",
        "Do not invent names, aliases, dates, identifiers, addresses, annexes, or actions.",
        "For amendments, preserve the legal act shape instead of inventing a full replacement entry.",
        "For removals, sparse identifying details are acceptable if that is all the source provides.",
        "If the source does not contain sanctions-list changes, return NO_DELTA with an empty records array.",
        "Evidence text must be a short exact excerpt copied from the source content."
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                candidate: {
                  id: input.candidate.id,
                  celexId: input.candidate.celexId,
                  cellarId: input.candidate.cellarId,
                  officialUri: input.candidate.officialUri,
                  title: input.candidate.title,
                  publicationDate: input.candidate.publicationDate
                },
                sourceContent: selectAiSourceContent(input.content)
              })
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "sanctions_delta_extraction",
          strict: true,
          schema: extractionSchema
        }
      },
      max_output_tokens: resolveAiExtractionMaxOutputTokens()
    })
  });
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AiExtractionProviderError(
      `${providerConfig.providerLabel} extraction failed: ${response.status}${body ? ` ${body}` : ""}`
    );
  }

  const payload = (await response.json()) as ResponsesApiPayload;
  const parsed = sanitizeAiExtraction(parseStructuredOutput(payload));
  const aiCall = buildAiCallMetadata({
    durationMs,
    model: providerConfig.model,
    payload,
    provider: providerConfig.provider
  });
  const extractionResult: ExtractionResult = {
    id: ["extraction", input.candidate.id, providerConfig.parserVersion, randomUUID()].join("-"),
    candidateId: input.candidate.id,
    parserVersion: providerConfig.parserVersion,
    classification: parsed.classification,
    confidence: clampConfidence(parsed.confidence),
    annexFound: parsed.annexFound,
    ...(parsed.annexHeading ? { annexHeading: parsed.annexHeading } : {}),
    isComplete: parsed.isComplete,
    ...(parsed.evidenceSummary ? { evidenceText: parsed.evidenceSummary } : {}),
    aiCall,
    createdAt: input.createdAt
  };
  const records = parsed.records.map((record, index): SanctionsDeltaRecord => ({
    id: `delta-${input.candidate.id}-ai-${index + 1}`,
    candidateId: input.candidate.id,
    recordType: record.recordType,
    actionType: record.actionType,
    primaryName: record.primaryName,
    listedEntry: Object.fromEntries(record.listedEntryFields.map((field) => [field.field, field.value])),
    ...(record.affectedAnnex ? { affectedAnnex: record.affectedAnnex } : {}),
    ...(record.detectedBaseAct ? { detectedBaseAct: record.detectedBaseAct } : {}),
    sourceOrder: index + 1,
    ...(record.sourceLocation ? { sourceLocation: record.sourceLocation } : {}),
    evidenceText: record.evidenceText,
    confidence: clampConfidence(record.confidence)
  }));

  return {
    candidate: {
      ...input.candidate,
      status: parsed.isComplete && records.length > 0 ? "EXTRACTED_COMPLETE" : applyClassificationStatus(parsed.classification)
    },
    extractionResult,
    records
  };
}

function sanitizeAiExtraction(parsed: OpenAiExtractionResponse): OpenAiExtractionResponse {
  const records = parsed.records.filter(isSupportedListedEntryRecord);

  if (records.length === parsed.records.length) {
    return parsed;
  }

  if (records.length === 0) {
    return {
      ...parsed,
      classification: "NO_DELTA",
      confidence: Math.min(parsed.confidence, 0.85),
      annexFound: false,
      annexHeading: "",
      isComplete: true,
      evidenceSummary:
        "AI output only contained legal provision or derogation references, not supported listed person/entity entry changes.",
      records
    };
  }

  return {
    ...parsed,
    records,
    evidenceSummary: parsed.evidenceSummary
      ? `${parsed.evidenceSummary} Unsupported legal provision records were excluded.`
      : "Unsupported legal provision records were excluded."
  };
}

function isSupportedListedEntryRecord(record: OpenAiExtractionResponse["records"][number]): boolean {
  const primaryName = normalizeWhitespace(record.primaryName);
  const affectedAnnex = normalizeWhitespace(record.affectedAnnex ?? "");

  if (!primaryName || isLegalProvisionReference(primaryName)) {
    return false;
  }

  if (isEntryNumberReference(primaryName) || isAnnexHeadingReference(primaryName)) {
    return false;
  }

  const listedEntryName = record.listedEntryFields.find((field) => /^name$/i.test(field.field.trim()))?.value;

  if (listedEntryName && isLegalProvisionReference(normalizeWhitespace(listedEntryName))) {
    return false;
  }

  if (affectedAnnex && isOnlyExistingEntryReference(affectedAnnex) && isDerogationEvidence(record.evidenceText)) {
    return false;
  }

  return true;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isLegalProvisionReference(value: string): boolean {
  return /^(article|paragraph|point|annex|regulation|council regulation|council decision|decision|implementing regulation)\b/i.test(value);
}

function isEntryNumberReference(value: string): boolean {
  return /^(entry|entries|entry number|entry numbers)\b/i.test(value);
}

function isAnnexHeadingReference(value: string): boolean {
  return /^annex\s+[ivxlcdm]+\s*(\(|$)/i.test(value);
}

function isOnlyExistingEntryReference(value: string): boolean {
  return /\bentry (number|numbers)\b/i.test(value) && !/\b(row|table|name|information|entry is replaced|entry is added)\b/i.test(value);
}

function isDerogationEvidence(value: string): boolean {
  return /\bderogation\b|\bauthorise\b|\bmay authori[sz]e\b|\brelease of certain frozen funds\b/i.test(value);
}

function buildAiCallMetadata(input: {
  provider: AiExtractionProvider;
  model: string;
  payload: ResponsesApiPayload;
  durationMs: number;
}): AiCallMetadata {
  const usage = parseAiUsage(input.payload.usage);
  const pricing = resolvePricing(input.model);
  const estimatedCostUsd = pricing ? estimateCostUsd(usage, pricing) : undefined;

  return {
    provider: input.provider,
    model: input.model,
    status: input.payload.status ?? "unknown",
    durationMs: input.durationMs,
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.cachedInputTokens !== undefined ? { cachedInputTokens: usage.cachedInputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
    ...(pricing
      ? {
          pricing: {
            inputUsdPerMillionTokens: pricing.inputUsdPerMillionTokens,
            outputUsdPerMillionTokens: pricing.outputUsdPerMillionTokens,
            source: pricing.source,
            ...(pricing.cachedInputUsdPerMillionTokens !== undefined
              ? { cachedInputUsdPerMillionTokens: pricing.cachedInputUsdPerMillionTokens }
              : {})
          }
        }
      : {})
  };
}

interface AiUsageSummary {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

function parseAiUsage(value: unknown): AiUsageSummary {
  if (!value || typeof value !== "object") {
    return {};
  }

  const usage = value as {
    input_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
    output_tokens?: unknown;
    output_tokens_details?: { reasoning_tokens?: unknown };
    total_tokens?: unknown;
  };

  return {
    ...numberField("inputTokens", usage.input_tokens),
    ...numberField("cachedInputTokens", usage.input_tokens_details?.cached_tokens),
    ...numberField("outputTokens", usage.output_tokens),
    ...numberField("reasoningTokens", usage.output_tokens_details?.reasoning_tokens),
    ...numberField("totalTokens", usage.total_tokens)
  };
}

function numberField<Key extends keyof AiUsageSummary>(key: Key, value: unknown): Pick<AiUsageSummary, Key> | {} {
  return typeof value === "number" && Number.isFinite(value) ? { [key]: value } as Pick<AiUsageSummary, Key> : {};
}

interface TokenPricing {
  inputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens: number;
  source: string;
}

function resolvePricing(model: string): TokenPricing | undefined {
  const normalizedModel = model.toLowerCase();

  if (normalizedModel === "gpt-5-mini" || normalizedModel.includes("gpt-5-mini")) {
    return {
      inputUsdPerMillionTokens: 0.25,
      cachedInputUsdPerMillionTokens: 0.025,
      outputUsdPerMillionTokens: 2,
      source: "OpenAI API pricing, per 1M text tokens"
    };
  }

  return undefined;
}

function estimateCostUsd(usage: AiUsageSummary, pricing: TokenPricing): number | undefined {
  const inputTokens = usage.inputTokens ?? 0;
  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, inputTokens);
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = usage.outputTokens ?? 0;

  if (inputTokens === 0 && outputTokens === 0) {
    return undefined;
  }

  const inputCost = (billableInputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens;
  const cachedInputCost = (cachedInputTokens / 1_000_000) * (pricing.cachedInputUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens);
  const outputCost = (outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens;

  return Number((inputCost + cachedInputCost + outputCost).toFixed(6));
}

function resolveAiExtractionMaxOutputTokens(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.AI_EXTRACTION_MAX_OUTPUT_TOKENS);
  return Number.isInteger(configured) && configured > 0 ? configured : defaultMaxOutputTokens;
}

export function resolveAiProviderRequestConfig(env: NodeJS.ProcessEnv = process.env): AiProviderRequestConfig {
  const provider = parseAiExtractionProvider(env.AI_EXTRACTION_PROVIDER);
  const model = resolveAiExtractionModel(env);

  if (provider === "azure-openai") {
    const apiKey = env.AZURE_OPENAI_API_KEY ?? env.AZURE_OPENAI_KEY;
    const endpoint = env.AZURE_OPENAI_ENDPOINT;

    if (!apiKey) {
      throw new AiExtractionConfigurationError("AZURE_OPENAI_API_KEY is required for Azure OpenAI extraction");
    }

    if (!endpoint) {
      throw new AiExtractionConfigurationError("AZURE_OPENAI_ENDPOINT is required for Azure OpenAI extraction");
    }

    return {
      provider,
      endpointUrl: buildAzureResponsesUrl(endpoint, env.AZURE_OPENAI_API_VERSION),
      headers: {
        "api-key": apiKey,
        "content-type": "application/json"
      },
      model,
      parserVersion: "azure-openai-structured-extractor-v1",
      providerLabel: "Azure OpenAI"
    };
  }

  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new AiExtractionConfigurationError("OPENAI_API_KEY is required for OpenAI extraction");
  }

  return {
    provider,
    endpointUrl: "https://api.openai.com/v1/responses",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    model,
    parserVersion: "openai-structured-extractor-v1",
    providerLabel: "OpenAI"
  };
}

function resolveAiExtractionModel(env: NodeJS.ProcessEnv): string {
  return (
    env.AI_EXTRACTION_MODEL ??
    env.OPENAI_EXTRACTION_MODEL ??
    env.AZURE_OPENAI_DEPLOYMENT ??
    env.AZURE_OPENAI_MODEL ??
    defaultModel
  );
}

function parseAiExtractionProvider(value: string | undefined): AiExtractionProvider {
  if (!value || value === defaultProvider || value === "openai") {
    return "openai";
  }

  if (value === "azure-openai") {
    return value;
  }

  throw new AiExtractionConfigurationError(`Unsupported AI_EXTRACTION_PROVIDER: ${value}`);
}

function buildAzureResponsesUrl(endpoint: string, apiVersion: string | undefined): string {
  const baseUrl = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  const normalizedEndpoint = endpoint.replace(/\/+$/, "");
  const url = normalizedEndpoint.endsWith("/openai/v1/responses")
    ? new URL(baseUrl)
    : normalizedEndpoint.endsWith("/openai/v1")
    ? new URL("responses", baseUrl)
    : new URL("openai/v1/responses", baseUrl);
  const normalizedApiVersion = normalizeAzureResponsesApiVersion(apiVersion);

  if (normalizedApiVersion) {
    url.searchParams.set("api-version", normalizedApiVersion);
  }

  return url.toString();
}

function normalizeAzureResponsesApiVersion(apiVersion: string | undefined): string | undefined {
  if (!apiVersion || apiVersion === "v1") {
    return undefined;
  }

  // The Azure OpenAI v1 Responses API rejects older inference preview versions.
  if (/^20\d{2}-\d{2}-\d{2}(-preview)?$/.test(apiVersion)) {
    return undefined;
  }

  return apiVersion;
}

export function selectAiSourceContent(content: string): string {
  if (content.length <= maxSourceCharacters) {
    return content;
  }

  const annexIndex = findFirstAnnexIndex(content);
  const start = Math.max(0, (annexIndex ?? 0) - 5_000);

  return content.slice(start, start + maxSourceCharacters);
}

function findFirstAnnexIndex(content: string): number | undefined {
  const match = content.match(/\bAnnex\b/i);
  return match?.index;
}

function parseStructuredOutput(payload: ResponsesApiPayload): OpenAiExtractionResponse {
  const text = typeof payload.output_text === "string" && payload.output_text.length > 0
    ? payload.output_text
    : findOutputText(payload.output);

  if (!text) {
    throw new AiExtractionProviderError(
      `AI extraction response did not include structured output text${describeResponseMetadata(payload)}`
    );
  }

  try {
    return JSON.parse(text) as OpenAiExtractionResponse;
  } catch (cause) {
    throw new AiExtractionProviderError(
      `AI extraction returned invalid JSON structured output${describeResponseMetadata(payload, text)}. ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
  }
}

function describeResponseMetadata(payload: ResponsesApiPayload, text?: string): string {
  return ` (status=${payload.status ?? "unknown"}, incomplete=${JSON.stringify(
    payload.incomplete_details ?? null
  )}, outputTextLength=${text?.length ?? 0}, usage=${JSON.stringify(payload.usage ?? null)})`;
}

function findOutputText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOutputText(item);
      if (found) {
        return found;
      }
    }
  }

  if (value && typeof value === "object") {
    const object = value as { type?: unknown; text?: unknown; content?: unknown };

    if (object.type === "output_text" && typeof object.text === "string") {
      return object.text;
    }

    return findOutputText(object.content);
  }

  return undefined;
}

function applyClassificationStatus(classification: OpenAiExtractionResponse["classification"]): CandidateLegalAct["status"] {
  if (classification === "NO_DELTA") {
    return "NO_DELTA";
  }

  if (classification === "PARSING_FAILED") {
    return "FAILED_PARSING";
  }

  return "NEEDS_EXTRACTION_CORRECTION";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["classification", "confidence", "annexFound", "annexHeading", "isComplete", "evidenceSummary", "records"],
  properties: {
    classification: {
      type: "string",
      enum: ["DELTA", "NO_DELTA", "UNCERTAIN_NO_DELTA", "PARSING_FAILED"]
    },
    confidence: {
      type: "number"
    },
    annexFound: {
      type: "boolean"
    },
    annexHeading: {
      type: "string"
    },
    isComplete: {
      type: "boolean"
    },
    evidenceSummary: {
      type: "string"
    },
    records: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "recordType",
          "actionType",
          "primaryName",
          "listedEntryFields",
          "affectedAnnex",
          "detectedBaseAct",
          "sourceLocation",
          "evidenceText",
          "confidence"
        ],
        properties: {
          recordType: {
            type: "string",
            enum: ["PERSON", "ENTITY"]
          },
          actionType: {
            type: "string",
            enum: ["ADD", "AMEND", "REMOVE", "REPLACE"]
          },
          primaryName: {
            type: "string"
          },
          listedEntryFields: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["field", "value"],
              properties: {
                field: {
                  type: "string"
                },
                value: {
                  type: "string"
                }
              }
            }
          },
          affectedAnnex: {
            type: "string"
          },
          detectedBaseAct: {
            type: "string"
          },
          sourceLocation: {
            type: "string"
          },
          evidenceText: {
            type: "string"
          },
          confidence: {
            type: "number"
          }
        }
      }
    }
  }
} as const;
