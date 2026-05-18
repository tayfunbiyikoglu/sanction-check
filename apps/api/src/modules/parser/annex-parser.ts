import type { DeltaAction, RecordType, SanctionsDeltaRecord } from "@sanctions/domain";
import {
  annexParserVersion,
  type AnnexExtractionResult,
  type AnnexParserInput,
  type ParserValidationIssue
} from "./types.js";

interface AnnexBlock {
  attributes: Record<string, string>;
  body: string;
  ordinal: number;
}

interface SectionBlock {
  attributes: Record<string, string>;
  body: string;
  ordinal: number;
}

interface RowBlock {
  attributes: Record<string, string>;
  body: string;
  ordinal: number;
}

interface Cell {
  name: string;
  value: string;
}

const actionValues = new Set<DeltaAction>(["ADD", "AMEND", "REMOVE", "REPLACE"]);
const recordTypeValues = new Set<RecordType>(["PERSON", "ENTITY"]);

export function extractAnnexSanctionsDeltaRecords(input: AnnexParserInput): AnnexExtractionResult {
  if (input.contentType === "application/xml") {
    return extractFromXmlFixture(input);
  }

  if (input.contentType === "text/html") {
    return extractFromEurLexHtml(input);
  }

  return {
    parserVersion: annexParserVersion,
    records: [],
    validationIssues: [
      {
        code: "UNSUPPORTED_STRUCTURE",
        message: `${input.contentType} Annex extraction is not supported by the deterministic fixture parser`
      }
    ],
    isComplete: false
  };
}

function extractFromEurLexHtml(input: AnnexParserInput): AnnexExtractionResult {
  const normalizedText = normalizeWhitespace(stripTags(input.content));
  const annexFound = /\bANNEX\b/i.test(normalizedText);

  if (!annexFound) {
    return {
      parserVersion: annexParserVersion,
      records: [],
      validationIssues: [
        {
          code: "ANNEX_NOT_FOUND",
          message: "No Annex boundary was found in the source content"
        }
      ],
      isComplete: false
    };
  }

  const actionType = inferHtmlAction(normalizedText);
  const records: SanctionsDeltaRecord[] = [];
  const validationIssues: ParserValidationIssue[] = [];

  if (!actionType) {
    validationIssues.push({
      code: "MISSING_ACTION_TYPE",
      message: "The EUR-Lex HTML Annex did not contain a supported Delta Action",
      sourceLocation: "Annex I"
    });
  }

  let currentRecordType: RecordType | undefined;
  let sourceOrder = 1;

  for (const block of extractHtmlBlocks(input.content)) {
    if (block.type === "section") {
      currentRecordType = block.recordType;
      continue;
    }

    if (!currentRecordType || !actionType) {
      continue;
    }

    const cells = block.cells;

    if (cells.length < 2 || !isNumberedAnnexRow(cells[0] ?? "")) {
      continue;
    }

    const sourceRow = normalizeAnnexRowNumber(cells[0] ?? String(sourceOrder));
    const primaryName = firstLine(cells[1] ?? "") ?? "Unknown";
    const sourceLocation = `Annex I; ${currentRecordType === "PERSON" ? "Persons" : "Entities"}; row ${sourceRow}`;
    const listedEntry = {
      name: cells[1] ?? primaryName,
      ...(cells[2] ? { identifyinginformation: cells[2] } : {}),
      ...(cells[3] ? { reasons: cells[3] } : {}),
      ...(cells[4] ? { dateoflisting: cells[4] } : {})
    };

    records.push({
      id: buildRecordId(input.candidateId, sourceLocation),
      candidateId: input.candidateId,
      recordType: currentRecordType,
      actionType,
      primaryName,
      affectedAnnex: "Annex I",
      sourceOrder,
      sourceLocation,
      evidenceText: cells.filter(Boolean).join("; "),
      confidence: 0.86,
      listedEntry
    });
    sourceOrder += 1;
  }

  const expectedCount = inferExpectedHtmlRecordCount(normalizedText);

  if (expectedCount !== undefined && expectedCount !== records.length) {
    validationIssues.push({
      code: "COUNT_MISMATCH",
      message: `Annex expected ${expectedCount} records but ${records.length} were extracted`,
      sourceLocation: "Annex I"
    });
  }

  if (records.length === 0) {
    validationIssues.push({
      code: "ANNEX_FOUND_NO_NAMES",
      message: "Annex was found but no supported listed-entry rows were extracted",
      sourceLocation: "Annex I"
    });
  }

  return {
    parserVersion: annexParserVersion,
    records,
    validationIssues,
    isComplete: records.length > 0 && validationIssues.length === 0
  };
}

function extractFromXmlFixture(input: AnnexParserInput): AnnexExtractionResult {
  const validationIssues: ParserValidationIssue[] = [];
  const annexes = parseBlocks(input.content, "annex").map((block): AnnexBlock => block);

  if (annexes.length === 0) {
    return {
      parserVersion: annexParserVersion,
      records: [],
      validationIssues: [
        {
          code: "ANNEX_NOT_FOUND",
          message: "No Annex boundary was found in the source content"
        }
      ],
      isComplete: false
    };
  }

  const records: SanctionsDeltaRecord[] = [];
  const seenLocations = new Set<string>();
  let sourceOrder = 1;

  for (const annex of annexes) {
    const affectedAnnex = annex.attributes.heading ?? formatAnnexHeading(annex.attributes.id, annex.ordinal);
    const sections = parseBlocks(annex.body, "section").map((block): SectionBlock => block);

    if (sections.length === 0) {
      validationIssues.push({
        code: "UNSUPPORTED_STRUCTURE",
        message: "Annex does not contain supported section blocks",
        sourceLocation: annexLocation(affectedAnnex)
      });
      continue;
    }

    let extractedInAnnex = 0;

    for (const section of sections) {
      const actionType = normalizeAction(section.attributes.action);
      const recordType = normalizeRecordType(section.attributes["record-type"]);
      const sectionLocation = `${annexLocation(affectedAnnex)}; section ${section.ordinal}`;

      if (!actionType) {
        validationIssues.push({
          code: "MISSING_ACTION_TYPE",
          message: "Section is missing a supported Delta Action",
          sourceLocation: sectionLocation
        });
      }

      if (!recordType) {
        validationIssues.push({
          code: "MISSING_RECORD_TYPE",
          message: "Section is missing PERSON or ENTITY record type",
          sourceLocation: sectionLocation
        });
      }

      const rows = parseBlocks(section.body, "row").map((block): RowBlock => block);

      if (rows.length === 0) {
        validationIssues.push({
          code: "UNSUPPORTED_STRUCTURE",
          message: "Section does not contain supported source rows",
          sourceLocation: sectionLocation
        });
        continue;
      }

      if (!actionType || !recordType) {
        continue;
      }

      for (const row of rows) {
        const sourceLocation = rowLocation(affectedAnnex, section.ordinal, row);

        if (seenLocations.has(sourceLocation)) {
          validationIssues.push({
            code: "DUPLICATE_SOURCE_LOCATION",
            message: "Duplicate source row location was ignored",
            sourceLocation
          });
          continue;
        }

        seenLocations.add(sourceLocation);
        extractedInAnnex += 1;

        const cells = parseCells(row.body);
        const listedEntry = buildListedEntry(cells);
        const primaryName = row.attributes.name ?? firstCellValue(cells, "name") ?? firstNonEmptyCell(cells) ?? "Unknown";
        const evidenceText = normalizeWhitespace(row.attributes.evidence ?? stripTags(row.body));

        records.push({
          id: buildRecordId(input.candidateId, sourceLocation),
          candidateId: input.candidateId,
          recordType,
          actionType,
          primaryName,
          affectedAnnex,
          sourceOrder,
          sourceLocation,
          evidenceText,
          confidence: 0.99,
          listedEntry
        });

        sourceOrder += 1;
      }
    }

    const expectedCount = parseExpectedCount(annex.attributes["expected-record-count"]);
    if (expectedCount !== undefined && expectedCount !== extractedInAnnex) {
      validationIssues.push({
        code: "COUNT_MISMATCH",
        message: `Annex expected ${expectedCount} records but ${extractedInAnnex} were extracted`,
        sourceLocation: annexLocation(affectedAnnex)
      });
    }
  }

  return {
    parserVersion: annexParserVersion,
    records,
    validationIssues,
    isComplete: validationIssues.length === 0
  };
}

function parseBlocks(content: string, tagName: string): Array<{ attributes: Record<string, string>; body: string; ordinal: number }> {
  const blocks: Array<{ attributes: Record<string, string>; body: string; ordinal: number }> = [];
  const tagPattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  let match: RegExpExecArray | null;
  let ordinal = 1;

  while ((match = tagPattern.exec(content)) !== null) {
    blocks.push({
      attributes: parseAttributes(match[1] ?? ""),
      body: match[2] ?? "",
      ordinal
    });
    ordinal += 1;
  }

  return blocks;
}

function extractHtmlBlocks(content: string): Array<
  | { type: "section"; recordType: RecordType }
  | { type: "row"; cells: string[] }
> {
  const blocks: Array<
    | { type: "section"; recordType: RecordType }
    | { type: "row"; cells: string[] }
  > = [];
  const pattern = /(<p\b[^>]*class="[^"]*oj-ti-grseq-1[^"]*"[^>]*>[\s\S]*?<\/p>|<tr\b[\s\S]*?<\/tr>)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const block = match[1] ?? "";
    const blockText = normalizeWhitespace(stripTags(block));

    if (/^persons$/i.test(blockText)) {
      blocks.push({ type: "section", recordType: "PERSON" });
      continue;
    }

    if (/^entities$/i.test(blockText)) {
      blocks.push({ type: "section", recordType: "ENTITY" });
      continue;
    }

    if (/^<tr\b/i.test(block)) {
      const cells = [...block.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
        stripHtmlCell(cell[1] ?? "")
      );
      blocks.push({ type: "row", cells });
    }
  }

  return blocks;
}

function inferHtmlAction(content: string): DeltaAction | undefined {
  if (/following persons and entities are added|following persons are added|following entities are added/i.test(content)) {
    return "ADD";
  }

  if (/entries concerning .* are replaced|entry concerning .* is replaced/i.test(content)) {
    return "REPLACE";
  }

  if (/is deleted from annex|are deleted from annex/i.test(content)) {
    return "REMOVE";
  }

  if (/annex\s+[ivxlcdm]+\s+is amended as follows/i.test(content)) {
    return "AMEND";
  }

  return undefined;
}

function inferExpectedHtmlRecordCount(content: string): number | undefined {
  const match = content.match(/\b(\d+)\s+persons?\s+and\s+(\d+)\s+entit(?:y|ies)\b/i);

  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return Number.parseInt(match[1], 10) + Number.parseInt(match[2], 10);
}

function isNumberedAnnexRow(value: string): boolean {
  return /^[‘'"]?\d+\./.test(value.trim());
}

function normalizeAnnexRowNumber(value: string): string {
  return value.trim().replace(/^[‘'"]+/, "").replace(/\.$/, "");
}

function firstLine(value: string): string | undefined {
  const [line] = value.split(/\n|\s+(?=(?:Russian|Ukrainian|a\.k\.a|D\.O\.B|DOB|Function|Address|Type of entity):)/i);
  const cleaned = normalizeWhitespace(line ?? "");
  return cleaned || undefined;
}

function stripHtmlCell(value: string): string {
  return stripTags(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p\b/gi, "</p>\n<p")
  )
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n");
}

function parseAttributes(rawAttributes: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(rawAttributes)) !== null) {
    const [, name, value] = match;
    if (name && value !== undefined) {
      attributes[name.toLowerCase()] = decodeXmlEntities(value);
    }
  }

  return attributes;
}

function parseCells(rowBody: string): Cell[] {
  return parseBlocks(rowBody, "cell").map((cell): Cell => {
    return {
      name: cell.attributes.name?.trim().toLowerCase() ?? `cell-${cell.ordinal}`,
      value: normalizeWhitespace(stripTags(cell.body))
    };
  });
}

function buildListedEntry(cells: Cell[]): Record<string, string | string[]> {
  const entry: Record<string, string | string[]> = {};

  for (const cell of cells) {
    if (!cell.value) {
      continue;
    }

    const existing = entry[cell.name];
    if (Array.isArray(existing)) {
      existing.push(cell.value);
    } else if (typeof existing === "string") {
      entry[cell.name] = [existing, cell.value];
    } else {
      entry[cell.name] = cell.value;
    }
  }

  return entry;
}

function normalizeAction(value: string | undefined): DeltaAction | undefined {
  const normalized = value?.trim().toUpperCase();
  return actionValues.has(normalized as DeltaAction) ? (normalized as DeltaAction) : undefined;
}

function normalizeRecordType(value: string | undefined): RecordType | undefined {
  const normalized = value?.trim().toUpperCase();
  return recordTypeValues.has(normalized as RecordType) ? (normalized as RecordType) : undefined;
}

function parseExpectedCount(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstCellValue(cells: Cell[], name: string): string | undefined {
  return cells.find((cell) => cell.name === name && cell.value)?.value;
}

function firstNonEmptyCell(cells: Cell[]): string | undefined {
  return cells.find((cell) => cell.value)?.value;
}

function formatAnnexHeading(id: string | undefined, ordinal: number): string {
  return id ? `Annex ${id}` : `Annex ${ordinal}`;
}

function annexLocation(affectedAnnex: string): string {
  return affectedAnnex;
}

function rowLocation(affectedAnnex: string, sectionOrdinal: number, row: RowBlock): string {
  return `${annexLocation(affectedAnnex)}; section ${sectionOrdinal}; row ${row.attributes.id ?? row.ordinal}`;
}

function buildRecordId(candidateId: string, sourceLocation: string): string {
  return `delta-${candidateId}-${sourceLocation.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function stripTags(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, " "));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}
