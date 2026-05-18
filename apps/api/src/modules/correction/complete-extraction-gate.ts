import type {
  CandidateLegalAct,
  CompleteExtractionGateResult,
  ExtractionResult,
  SanctionsDeltaRecord
} from "@sanctions/domain";
import type { ParserValidationIssue } from "../parser/types.js";

export interface CompleteExtractionGateInput {
  candidate: CandidateLegalAct;
  extractionResult?: ExtractionResult;
  records: SanctionsDeltaRecord[];
  validationIssues?: ParserValidationIssue[];
}

export function evaluateCompleteExtractionGate(
  input: CompleteExtractionGateInput
): CompleteExtractionGateResult {
  const blockers: string[] = [];

  if (!input.candidate.sourceContent && input.extractionResult?.classification !== "NO_DELTA") {
    blockers.push("Official English source content has not been retrieved");
  }

  if (input.candidate.status === "LANGUAGE_PENDING") {
    blockers.push("Official English source content is not available yet");
  }

  if (input.candidate.status === "FAILED_RETRIEVAL") {
    blockers.push("Official source content retrieval failed");
  }

  if (input.candidate.status === "FAILED_PARSING" || input.extractionResult?.classification === "PARSING_FAILED") {
    blockers.push("Source content parsing failed");
  }

  if (!input.extractionResult) {
    blockers.push("Candidate legal act has not been classified");
  } else if (input.extractionResult.classification === "NO_DELTA") {
    return {
      ready: blockers.length === 0,
      blockers
    };
  } else if (!input.extractionResult.annexFound) {
    blockers.push("Annex boundaries have not been identified");
  }

  if ((input.validationIssues ?? []).length > 0) {
    for (const issue of input.validationIssues ?? []) {
      blockers.push(`${issue.code}: ${issue.message}`);
    }
  }

  if (input.extractionResult && input.extractionResult.classification !== "NO_DELTA") {
    if (input.records.length === 0) {
      blockers.push("No sanctions delta records have been extracted");
    }

    for (const record of input.records) {
      if (!record.actionType) {
        blockers.push(`Record ${record.id} is missing Delta Action`);
      }

      if (!record.recordType) {
        blockers.push(`Record ${record.id} is missing person/entity classification`);
      }

      if (!record.evidenceText) {
        blockers.push(`Record ${record.id} is missing Evidence Text`);
      }

      if (!record.sourceLocation) {
        blockers.push(`Record ${record.id} is missing source location`);
      }

      if (!record.primaryName) {
        blockers.push(`Record ${record.id} is missing primary name from source`);
      }
    }
  }

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)]
  };
}
