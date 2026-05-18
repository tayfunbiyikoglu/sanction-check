import type { CandidateClassification } from "@sanctions/domain";

export interface ClassificationResult {
  classification: CandidateClassification;
  confidence: number;
  annexFound: boolean;
  annexHeading?: string;
  evidenceText?: string;
}

const deltaPhrases = [
  /following persons and entities are added/i,
  /following persons are added/i,
  /following entities are added/i,
  /entries concerning .* are replaced/i,
  /entry concerning .* is replaced/i,
  /is deleted from annex/i,
  /are deleted from annex/i,
  /annex\s+[ivxlcdm]+\s+is amended as follows/i
];

export function classifyCandidateSourceContent(content: string): ClassificationResult {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return {
      classification: "PARSING_FAILED",
      confidence: 0,
      annexFound: false,
      evidenceText: "Source content was empty"
    };
  }

  const annexMatch = normalized.match(/annex\s+([ivxlcdm]+)/i);
  const annexFound = annexMatch !== null;
  const annexHeading = annexMatch ? `Annex ${annexMatch[1]!.toUpperCase()}` : undefined;
  const deltaPhrase = deltaPhrases.find((phrase) => phrase.test(normalized));

  if (!deltaPhrase && hasStrongNoDeltaEvidence(normalized)) {
    return {
      classification: "NO_DELTA",
      confidence: 0.85,
      annexFound: false,
      evidenceText: extractSentence(normalized, /no annex listed-entry changes|no listed-entry changes are made/i)
    };
  }

  if (deltaPhrase) {
    return {
      classification: "DELTA",
      confidence: 0.9,
      annexFound,
      ...(annexHeading ? { annexHeading } : {}),
      evidenceText: extractEvidence(normalized, deltaPhrase)
    };
  }

  if (annexFound) {
    return {
      classification: "UNCERTAIN_NO_DELTA",
      confidence: 0.45,
      annexFound: true,
      ...(annexHeading ? { annexHeading } : {}),
      evidenceText: extractSentence(normalized, /annex/i)
    };
  }

  return {
    classification: "NO_DELTA",
    confidence: 0.7,
    annexFound: false,
    evidenceText: normalized.slice(0, 240)
  };
}

function hasStrongNoDeltaEvidence(content: string) {
  return /no annex listed-entry changes/i.test(content) || /no listed-entry changes are made/i.test(content);
}

function extractEvidence(content: string, phrase: RegExp) {
  return extractSentence(content, phrase);
}

function extractSentence(content: string, phrase: RegExp) {
  const sentences = content.split(/(?<=[.!?])\s+/);
  return sentences.find((sentence) => phrase.test(sentence)) ?? content.slice(0, 240);
}
