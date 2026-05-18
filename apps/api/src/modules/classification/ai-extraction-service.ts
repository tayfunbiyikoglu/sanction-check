import { randomUUID } from "node:crypto";
import type { CandidateLegalAct, ExtractionResult, SanctionsDeltaRecord } from "@sanctions/domain";

const defaultModel = "gpt-5-mini";
const parserVersion = "openai-structured-extractor-v1";
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

export async function extractSanctionsDeltaRecordsWithAi(input: {
  candidate: CandidateLegalAct;
  content: string;
  createdAt: string;
  fetchImpl?: typeof fetch;
}): Promise<AiExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new AiExtractionConfigurationError("OPENAI_API_KEY is required for AI-assisted extraction");
  }

  const fetcher = input.fetchImpl ?? fetch;
  const model = process.env.OPENAI_EXTRACTION_MODEL ?? defaultModel;
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions: [
        "You extract EU sanctions-list changes from official EUR-Lex/CELLAR Source Content.",
        "Return only records that are explicitly supported by evidence text in the supplied source.",
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
      }
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AiExtractionProviderError(`OpenAI extraction failed: ${response.status}${body ? ` ${body}` : ""}`);
  }

  const payload = (await response.json()) as { output_text?: string; output?: unknown };
  const parsed = parseStructuredOutput(payload);
  const extractionResult: ExtractionResult = {
    id: ["extraction", input.candidate.id, parserVersion, randomUUID()].join("-"),
    candidateId: input.candidate.id,
    parserVersion,
    classification: parsed.classification,
    confidence: clampConfidence(parsed.confidence),
    annexFound: parsed.annexFound,
    ...(parsed.annexHeading ? { annexHeading: parsed.annexHeading } : {}),
    isComplete: parsed.isComplete,
    ...(parsed.evidenceSummary ? { evidenceText: parsed.evidenceSummary } : {}),
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

function parseStructuredOutput(payload: { output_text?: string; output?: unknown }): OpenAiExtractionResponse {
  if (typeof payload.output_text === "string" && payload.output_text.length > 0) {
    return JSON.parse(payload.output_text) as OpenAiExtractionResponse;
  }

  const text = findOutputText(payload.output);

  if (!text) {
    throw new Error("OpenAI extraction response did not include structured output text");
  }

  return JSON.parse(text) as OpenAiExtractionResponse;
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
