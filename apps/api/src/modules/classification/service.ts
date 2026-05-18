import type { CandidateLegalAct, ExtractionResult } from "@sanctions/domain";
import { classifyCandidateSourceContent } from "./classifier.js";

const parserVersion = "deterministic-classifier-v1";

export function classifyCandidateLegalAct(input: {
  candidate: CandidateLegalAct;
  content: string;
  createdAt: string;
}): { candidate: CandidateLegalAct; extractionResult: ExtractionResult } {
  const classification = classifyCandidateSourceContent(input.content);
  const candidate = applyClassificationToCandidate(input.candidate, classification.classification);

  return {
    candidate,
    extractionResult: {
      id: `extraction-${candidate.id}-${parserVersion}`,
      candidateId: candidate.id,
      parserVersion,
      classification: classification.classification,
      confidence: classification.confidence,
      annexFound: classification.annexFound,
      ...(classification.annexHeading ? { annexHeading: classification.annexHeading } : {}),
      isComplete: classification.classification === "NO_DELTA",
      ...(classification.evidenceText ? { evidenceText: classification.evidenceText } : {}),
      createdAt: input.createdAt
    }
  };
}

function applyClassificationToCandidate(
  candidate: CandidateLegalAct,
  classification: ExtractionResult["classification"]
): CandidateLegalAct {
  if (classification === "NO_DELTA") {
    return { ...candidate, status: "NO_DELTA" };
  }

  if (classification === "DELTA" || classification === "UNCERTAIN_NO_DELTA") {
    return { ...candidate, status: "NEEDS_EXTRACTION_CORRECTION" };
  }

  return { ...candidate, status: "FAILED_PARSING" };
}
