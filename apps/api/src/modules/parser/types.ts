import type { SanctionsDeltaRecord } from "@sanctions/domain";

export const annexParserVersion = "deterministic-annex-parser-v1";

export type ParserContentType = "application/xml" | "text/html" | "text/plain";

export type ParserValidationCode =
  | "ANNEX_NOT_FOUND"
  | "ANNEX_FOUND_NO_NAMES"
  | "COUNT_MISMATCH"
  | "DUPLICATE_SOURCE_LOCATION"
  | "MISSING_ACTION_TYPE"
  | "MISSING_RECORD_TYPE"
  | "UNSUPPORTED_STRUCTURE";

export interface ParserValidationIssue {
  code: ParserValidationCode;
  message: string;
  sourceLocation?: string;
}

export interface AnnexExtractionResult {
  parserVersion: typeof annexParserVersion;
  records: SanctionsDeltaRecord[];
  validationIssues: ParserValidationIssue[];
  isComplete: boolean;
}

export interface AnnexParserInput {
  candidateId: string;
  content: string;
  contentType: ParserContentType;
  sourceUri?: string | undefined;
}
