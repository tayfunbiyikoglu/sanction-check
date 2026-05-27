import type {
  CandidateLegalAct,
  CompleteExtractionGateCheck,
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
  const checks: CompleteExtractionGateCheck[] = [];

  function addCheck(id: string, label: string, passed: boolean, message: string) {
    checks.push({ id, label, passed, message });
    if (!passed) {
      blockers.push(message);
    }
  }

  addCheck(
    "official-source-content",
    "Official English source content",
    Boolean(input.candidate.sourceContent) || input.extractionResult?.classification === "NO_DELTA",
    "Official English source content has not been retrieved"
  );

  addCheck(
    "english-language-available",
    "English language available",
    input.candidate.status !== "LANGUAGE_PENDING",
    "Official English source content is not available yet"
  );

  addCheck(
    "source-retrieval",
    "Source retrieval",
    input.candidate.status !== "FAILED_RETRIEVAL",
    "Official source content retrieval failed"
  );

  addCheck(
    "source-parsing",
    "Source parsing",
    input.candidate.status !== "FAILED_PARSING" && input.extractionResult?.classification !== "PARSING_FAILED",
    "Source content parsing failed"
  );

  if (!input.extractionResult) {
    addCheck("classification", "Classification", false, "Candidate legal act has not been classified");
  } else if (input.extractionResult.classification === "NO_DELTA") {
    return {
      ready: blockers.length === 0,
      blockers: [...new Set(blockers)],
      checks
    };
  } else {
    addCheck("classification", "Classification", true, "Candidate legal act has been classified");
    addCheck(
      "annex-boundaries",
      "Annex boundaries",
      input.extractionResult.annexFound,
      "Annex boundaries have not been identified"
    );
  }

  if ((input.validationIssues ?? []).length > 0) {
    for (const issue of input.validationIssues ?? []) {
      addCheck(`parser-validation-${issue.code}`, "Parser validation", false, `${issue.code}: ${issue.message}`);
    }
  } else {
    addCheck("parser-validation", "Parser validation", true, "No parser validation issues were reported");
  }

  if (input.extractionResult && input.extractionResult.classification !== "NO_DELTA") {
    addCheck(
      "records-extracted",
      "Records extracted",
      input.records.length > 0,
      "No sanctions delta records have been extracted"
    );

    for (const record of input.records) {
      if (!record.actionType) {
        addCheck(`record-${record.id}-action-type`, "Record Delta Action", false, `Record ${record.id} is missing Delta Action`);
      }

      if (!record.recordType) {
        addCheck(
          `record-${record.id}-record-type`,
          "Record person/entity classification",
          false,
          `Record ${record.id} is missing person/entity classification`
        );
      }

      if (!record.evidenceText) {
        addCheck(`record-${record.id}-evidence`, "Record Evidence Text", false, `Record ${record.id} is missing Evidence Text`);
      }

      if (!record.sourceLocation) {
        addCheck(
          `record-${record.id}-source-location`,
          "Record source location",
          false,
          `Record ${record.id} is missing source location`
        );
      }

      if (!record.primaryName) {
        addCheck(
          `record-${record.id}-primary-name`,
          "Record primary name",
          false,
          `Record ${record.id} is missing primary name from source`
        );
      }
    }

    if (input.records.length > 0) {
      addCheck(
        "record-required-fields",
        "Record required fields",
        !checks.some((check) => check.id.startsWith("record-") && !check.passed),
        "One or more records are missing required export evidence"
      );
    }

    addCheck(
      "complete-extraction-confirmed",
      "Extractor completeness signal",
      input.extractionResult.isComplete,
      describeIncompleteExtraction(input.extractionResult)
    );
  }

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    checks
  };
}

function describeIncompleteExtraction(extractionResult: ExtractionResult): string {
  if (extractionResult.parserVersion.startsWith("openai-")) {
    return "AI extractor returned incomplete; review official Annex coverage before marking complete";
  }

  return "Parser did not mark the latest extraction complete";
}
