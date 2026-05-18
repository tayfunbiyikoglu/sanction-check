import type { CandidateLegalAct, SourceContentReference } from "@sanctions/domain";

export type OfficialLanguage = "en" | "fr" | "de" | "es" | "it" | "nl" | "pl" | "bg" | "da" | "et" | "el" | "ga" | "hr" | "lv" | "lt" | "hu" | "mt" | "pt" | "ro" | "sk" | "sl" | "fi" | "sv" | "cs";

export type StorableOfficialContentType = "application/xml" | "text/html" | "text/plain";
export type OfficialContentType = StorableOfficialContentType | "application/pdf";

export interface OfficialSourceContent {
  language: OfficialLanguage;
  contentType: OfficialContentType;
  sourceUri: string;
  body: string;
}

export interface StorableOfficialSourceContent extends OfficialSourceContent {
  contentType: StorableOfficialContentType;
}

export interface OfficialSourceLookup {
  availableLanguages: OfficialLanguage[];
  contents: OfficialSourceContent[];
}

export interface OfficialSourceAdapter {
  retrieve(candidate: CandidateLegalAct): Promise<OfficialSourceLookup>;
}

export interface SourceContentRepository {
  store(input: {
    candidateId: string;
    content: StorableOfficialSourceContent;
    retrievedAt: string;
  }): Promise<SourceContentReference>;
  read(reference: string): Promise<string>;
}

export interface RetrievalClock {
  now(): Date;
}

export const systemClock: RetrievalClock = {
  now: () => new Date()
};
