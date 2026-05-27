import type { CandidateLegalAct, ExportBatch, SanctionsDeltaRecord } from "@sanctions/domain";
import { orderRecordsForExport } from "./record-ordering.js";

export const sanctionsUploadCsvColumns = [
  "COUNTRYOFORIGIN",
  "ENTRYDATE",
  "FIRSTNAME",
  "GENDER",
  "ID",
  "ISDELETED",
  "JUSTIFICATION",
  "LEGALSTATUS",
  "NAME",
  "YEAR"
] as const;

export function serializeSanctionsUploadCsv(input: {
  batch: Pick<ExportBatch, "id"> & Partial<Pick<ExportBatch, "createdAt">>;
  candidate: CandidateLegalAct;
  records: SanctionsDeltaRecord[];
}): string {
  const exportDate = formatCompactDate(input.batch.createdAt ?? input.candidate.publicationDate);
  const rows = orderRecordsForExport(input.records).map((record, index) => {
    const nameParts = splitExportName(record);
    const legalStatus = record.recordType === "ENTITY" ? "LEGAL_ENTITY" : "NATURAL_PERSON";

    return [
      "",
      formatEntryDate(readListedEntryField(record, "dateoflisting") ?? input.candidate.publicationDate),
      nameParts.firstName,
      inferGender(record),
      `${exportDate}${String(index + 1).padStart(4, "0")}`,
      "FALSE",
      "",
      legalStatus,
      nameParts.name,
      ""
    ];
  });

  return [sanctionsUploadCsvColumns.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n") + "\n";
}

function splitExportName(record: SanctionsDeltaRecord): { firstName: string; name: string } {
  const displayName = firstLine(readListedEntryField(record, "name") ?? record.primaryName).trim();

  if (record.recordType === "ENTITY") {
    return { firstName: "", name: displayName };
  }

  const parts = displayName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: "", name: displayName.toUpperCase() };
  }

  const surname = parts.at(-1) ?? "";
  return {
    firstName: parts.slice(0, -1).join(" "),
    name: surname.toUpperCase()
  };
}

function inferGender(record: SanctionsDeltaRecord): "MALE" | "FEMALE" | "NONE" {
  if (record.recordType === "ENTITY") {
    return "NONE";
  }

  const explicitGender = readListedEntryField(record, "gender")?.toLowerCase();
  if (explicitGender) {
    if (/\bfemale\b|\bwoman\b|\bwomen\b/.test(explicitGender)) {
      return "FEMALE";
    }

    if (/\bmale\b|\bman\b|\bmen\b/.test(explicitGender)) {
      return "MALE";
    }
  }

  const firstName = splitExportName(record).firstName.split(/\s+/)[0]?.toLowerCase() ?? "";
  const femaleFirstNames = new Set([
    "anastasia",
    "evgeniya",
    "irina",
    "lilya",
    "marina",
    "mariya",
    "natalya",
    "olga",
    "svetlana",
    "tatyana",
    "yulia"
  ]);

  if (femaleFirstNames.has(firstName) || /(?:a|aya|iya|ina|ovna|evna)$/.test(firstName)) {
    return "FEMALE";
  }

  return "MALE";
}

function readListedEntryField(record: SanctionsDeltaRecord, fieldName: string): string | undefined {
  const value = record.listedEntry?.[fieldName];

  if (Array.isArray(value)) {
    return value.join("; ");
  }

  return value;
}

function formatEntryDate(value: string | undefined): string {
  const date = parseDateParts(value);

  if (!date) {
    return "";
  }

  return `${date.year}-${date.month}-${date.day}`;
}

function formatCompactDate(value: string | undefined): string {
  const date = parseDateParts(value);

  if (!date) {
    return new Date().toISOString().slice(0, 10).replaceAll("-", "");
  }

  return `${date.year}${date.month}${date.day}`;
}

function parseDateParts(value: string | undefined): { year: string; month: string; day: string } | undefined {
  if (!value) {
    return undefined;
  }

  const isoMatch = value.match(/(?:^|\D)(\d{4})-(\d{2})-(\d{2})(?:\D|$)/);
  if (isoMatch) {
    return { year: isoMatch[1] ?? "", month: isoMatch[2] ?? "", day: isoMatch[3] ?? "" };
  }

  const dottedMatch = value.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (dottedMatch) {
    return {
      year: dottedMatch[3] ?? "",
      month: (dottedMatch[2] ?? "").padStart(2, "0"),
      day: (dottedMatch[1] ?? "").padStart(2, "0")
    };
  }

  return undefined;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() ?? "";
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\"", "\"\"")}"`;
}
