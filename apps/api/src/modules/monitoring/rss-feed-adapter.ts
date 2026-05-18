import type { WatchQuery } from "@sanctions/domain";
import type { DiscoveryTrigger } from "./service.js";
import type { MonitorWindow } from "./search-types.js";

export class RssFeedConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RssFeedConfigurationError";
  }
}

export interface RssFeedAdapterConfig {
  feedUrl?: string | undefined;
}

export interface RssFeedResult {
  feedUrl: string;
  body: string;
  triggers: DiscoveryTrigger[];
  errors: string[];
}

interface FeedEntry {
  body: string;
  ordinal: number;
}

export class LiveRssFeedAdapter {
  constructor(private readonly config: RssFeedAdapterConfig) {}

  async fetch(input: { watchQuery: WatchQuery; monitorWindow: MonitorWindow }): Promise<RssFeedResult> {
    if (!this.config.feedUrl) {
      throw new RssFeedConfigurationError("EUR-Lex RSS feed URL is required for live RSS monitoring");
    }

    const response = await fetch(this.config.feedUrl, {
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml"
      },
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`EUR-Lex RSS feed retrieval failed with status ${response.status}`);
    }

    const body = await response.text();
    return {
      feedUrl: response.url,
      body,
      ...parseRssFeed(body, input.watchQuery.name)
    };
  }
}

export function parseRssFeed(xml: string, feedName: string): { triggers: DiscoveryTrigger[]; errors: string[] } {
  const entries = extractEntries(xml);
  const triggers: DiscoveryTrigger[] = [];
  const errors: string[] = [];

  for (const entry of entries) {
    const trigger = parseEntry(entry.body, feedName);

    if (!trigger.celexId && !trigger.cellarId && !trigger.officialUri) {
      errors.push(`RSS item ${entry.ordinal} has no Legal Act Identity`);
      continue;
    }

    triggers.push(trigger);
  }

  return { triggers, errors };
}

function extractEntries(xml: string): FeedEntry[] {
  const rssItems = collectBlocks(xml, "item");

  if (rssItems.length > 0) {
    return rssItems.map((body, index) => ({ body, ordinal: index + 1 }));
  }

  return collectBlocks(xml, "entry").map((body, index) => ({ body, ordinal: index + 1 }));
}

function parseEntry(body: string, feedName: string): DiscoveryTrigger {
  const title = firstTagValue(body, "title") ?? "Untitled EUR-Lex RSS item";
  const link = firstLink(body);
  const guid = firstTagValue(body, "guid") ?? firstTagValue(body, "id");
  const description = firstTagValue(body, "description") ?? firstTagValue(body, "summary") ?? "";
  const identityText = [link, guid, title, description].filter(Boolean).join(" ");
  const celexId = extractCelexId(identityText);
  const cellarId = extractCellarId(identityText);
  const officialUri = link && isOfficialLegalActUri(link) ? link : undefined;
  const publicationDate = normalizeRssDate(
    firstTagValue(body, "pubDate") ?? firstTagValue(body, "published") ?? firstTagValue(body, "updated")
  );

  return {
    ...(celexId ? { celexId } : {}),
    ...(cellarId ? { cellarId } : {}),
    ...(officialUri ? { officialUri } : {}),
    title,
    ...(publicationDate ? { publicationDate } : {}),
    ...(link ? { sourceUrl: link } : {}),
    rssFeedName: feedName
  };
}

function firstLink(xml: string): string | undefined {
  return (
    firstTagValue(xml, "link") ??
    firstAttributeValue(xml, "href")
  );
}

function extractCelexId(value: string): string | undefined {
  const patterns = [
    /\bCELEX[:=]([0-9][0-9A-Z]{4,})\b/i,
    /[?&]uri=CELEX:([0-9][0-9A-Z]{4,})\b/i,
    /\bDN=([0-9][0-9A-Z]{4,})\b/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return undefined;
}

function extractCellarId(value: string): string | undefined {
  const match = value.match(/cellar[:/]([a-f0-9-]{20,})/i);
  return match?.[1]?.toLowerCase();
}

function isOfficialLegalActUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.endsWith("eur-lex.europa.eu") || url.hostname.endsWith("publications.europa.eu");
  } catch {
    return false;
  }
}

function normalizeRssDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const rfcDate = value.match(/\b(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/);

  if (rfcDate?.[1] && rfcDate[2] && rfcDate[3]) {
    const month = monthNumber(rfcDate[2]);

    if (month) {
      return `${rfcDate[3]}-${month}-${rfcDate[1].padStart(2, "0")}`;
    }
  }

  const isoDate = value.match(/^(\d{4}-\d{2}-\d{2})/);

  if (isoDate?.[1]) {
    return isoDate[1];
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 10);
}

function monthNumber(value: string): string | undefined {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.indexOf(value.toLowerCase());
  return index >= 0 ? String(index + 1).padStart(2, "0") : undefined;
}

function collectBlocks(xml: string, localName: string): string[] {
  const pattern = new RegExp(`<([\\w.-]+:)?${escapeRegExp(localName)}\\b[^>]*>([\\s\\S]*?)<\\/([\\w.-]+:)?${escapeRegExp(localName)}>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[2] ?? "");
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
  const cleaned = value
    ?.replace(new RegExp("<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>", "g"), "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? decodeXmlEntities(cleaned) : undefined;
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
