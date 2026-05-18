import type { DiscoveryTrigger } from "./service.js";

export interface ParsedEurLexSearchResponse {
  triggers: DiscoveryTrigger[];
  errors: string[];
}

interface ResultBlock {
  body: string;
  ordinal: number;
}

export function parseEurLexSearchResponse(xml: string): ParsedEurLexSearchResponse {
  const resultBlocks = extractResultBlocks(xml);
  const triggers: DiscoveryTrigger[] = [];
  const errors: string[] = [];

  for (const result of resultBlocks) {
    const trigger = parseResultBlock(result.body);

    if (!trigger.celexId && !trigger.cellarId && !trigger.officialUri) {
      errors.push(`Search result ${result.ordinal} has no Legal Act Identity`);
      continue;
    }

    triggers.push(trigger);
  }

  return { triggers, errors };
}

function extractResultBlocks(xml: string): ResultBlock[] {
  const blocks = collectBlocks(xml, "result");

  if (blocks.length > 0) {
    return blocks.map((body, index) => ({ body, ordinal: index + 1 }));
  }

  return collectBlocks(xml, "document").map((body, index) => ({ body, ordinal: index + 1 }));
}

function parseResultBlock(body: string): DiscoveryTrigger {
  const reference = firstValue(body, ["reference"]);
  const celexId = firstValue(body, ["CELEX", "celex", "celexId", "celex-id", "ID_CELEX", "DN"]);
  const cellarId =
    firstValue(body, ["CELLAR", "cellar", "cellarId", "cellar-id", "CELLAR_ID"]) ??
    parseCellarIdFromReference(reference);
  const officialUri = firstValue(body, ["URI", "uri", "officialUri", "official-uri", "RESOURCE_LEGAL_ID"]);
  const title =
    firstValue(body, ["TITLE", "title", "titleEn", "title-en", "EXPRESSION_TITLE", "expression-title"]) ??
    firstTypedValue(body, "EXPRESSION_TITLE") ??
    "Untitled EUR-Lex search result";
  const publicationDate = firstValue(body, ["DATE_PUBLICATION", "publicationDate", "publication-date", "date", "DD"]);
  const sourceUrl =
    firstValue(body, ["URL", "url", "sourceUrl", "source-url"]) ??
    buildEurLexUrl(celexId, officialUri);
  const discoveredAt = firstValue(body, ["discoveredAt", "discovered-at", "DATE_SEARCH", "search-date"]);

  return {
    ...(celexId ? { celexId } : {}),
    ...(cellarId ? { cellarId } : {}),
    ...(officialUri ? { officialUri } : {}),
    title,
    ...(publicationDate ? { publicationDate } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(discoveredAt ? { discoveredAt } : {})
  };
}

function parseCellarIdFromReference(reference: string | undefined): string | undefined {
  const match = reference?.match(/cellar:([a-f0-9-]+)/i);
  return match?.[1]?.toLowerCase();
}

function firstTypedValue(xml: string, type: string): string | undefined {
  const pattern = new RegExp(
    `<([\\w.-]+:)?VALUE\\b[^>]*TYPE=["']${escapeRegExp(type)}["'][^>]*>([\\s\\S]*?)<\\/([\\w.-]+:)?VALUE>`,
    "i"
  );
  const match = xml.match(pattern);
  return cleanValue(match?.[2]);
}

function collectBlocks(xml: string, localName: string): string[] {
  const pattern = new RegExp(`<([\\w.-]+:)?${escapeRegExp(localName)}\\b[^>]*>([\\s\\S]*?)<\\/([\\w.-]+:)?${escapeRegExp(localName)}>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[2] ?? "");
}

function firstValue(xml: string, localNames: string[]): string | undefined {
  for (const localName of localNames) {
    const tagValue = firstTagValue(xml, localName);

    if (tagValue) {
      return tagValue;
    }

    const attributeValue = firstAttributeValue(xml, localName);

    if (attributeValue) {
      return attributeValue;
    }
  }

  return undefined;
}

function firstTagValue(xml: string, localName: string): string | undefined {
  const pattern = new RegExp(`<([\\w.-]+:)?${escapeRegExp(localName)}\\b[^>]*>([\\s\\S]*?)<\\/([\\w.-]+:)?${escapeRegExp(localName)}>`, "i");
  const match = xml.match(pattern);
  return cleanValue(match?.[2]);
}

function firstAttributeValue(xml: string, attributeName: string): string | undefined {
  const pattern = new RegExp(`\\b${escapeRegExp(attributeName)}=["']([^"']+)["']`, "i");
  const match = xml.match(pattern);
  return cleanValue(match?.[1]);
}

function cleanValue(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? decodeXmlEntities(cleaned) : undefined;
}

function buildEurLexUrl(celexId: string | undefined, officialUri: string | undefined): string | undefined {
  if (officialUri?.startsWith("http")) {
    return officialUri;
  }

  return celexId ? `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${celexId}` : undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
