import type { CandidateLegalAct } from "@sanctions/domain";
import type { OfficialSourceAdapter, OfficialSourceLookup } from "./types.js";

export class RetrievalFailure extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "RetrievalFailure";
  }
}

export class MockEurLexCellarAdapter implements OfficialSourceAdapter {
  private readonly fixtures: Map<string, OfficialSourceLookup | RetrievalFailure>;

  constructor(fixtures: Record<string, OfficialSourceLookup | RetrievalFailure>) {
    this.fixtures = new Map(Object.entries(fixtures));
  }

  async retrieve(candidate: CandidateLegalAct): Promise<OfficialSourceLookup> {
    const fixture = lookupCandidateFixture(this.fixtures, candidate);

    if (!fixture) {
      throw new RetrievalFailure("SOURCE_NOT_FOUND", "Official source content was not found");
    }

    if (fixture instanceof RetrievalFailure) {
      throw fixture;
    }

    return fixture;
  }
}

function lookupCandidateFixture(
  fixtures: Map<string, OfficialSourceLookup | RetrievalFailure>,
  candidate: CandidateLegalAct
) {
  const keys = [candidate.celexId, candidate.cellarId, candidate.officialUri, candidate.id].filter(
    (key): key is string => Boolean(key)
  );

  for (const key of keys) {
    const fixture = fixtures.get(key);

    if (fixture) {
      return fixture;
    }
  }

  return undefined;
}

export const seededOfficialSourceFixtures: Record<string, OfficialSourceLookup | RetrievalFailure> = {
  "32026R1001": {
    availableLanguages: ["en", "fr"],
    contents: [
      {
        language: "en",
        contentType: "application/xml",
        sourceUri: "cellar:mock:32026R1001/en/xml",
        body: `<legalAct celex="32026R1001" lang="en"><annex id="I" heading="Annex I" expected-record-count="2"><p>The following persons and entities are added to the list set out in Annex I.</p><section action="ADD" record-type="PERSON"><row id="1" evidence="Jane Example; date of birth: 12 March 1975."><cell name="name">Jane Example</cell><cell name="dateOfBirth">12 March 1975</cell></row></section><section action="ADD" record-type="ENTITY"><row id="2" evidence="Example Entity Ltd; registration number EU-0001."><cell name="name">Example Entity Ltd</cell><cell name="registrationNumber">EU-0001</cell></row></section></annex></legalAct>`
      },
      {
        language: "fr",
        contentType: "application/xml",
        sourceUri: "cellar:mock:32026R1001/fr/xml",
        body: `<acte celex="32026R1001" lang="fr" />`
      }
    ]
  },
  "32026R1002": {
    availableLanguages: ["en"],
    contents: [
      {
        language: "en",
        contentType: "text/html",
        sourceUri: "cellar:mock:32026R1002/en/html",
        body: "<html lang=\"en\"><body><h1>Annex I</h1><p>Official English content needing extraction correction.</p></body></html>"
      }
    ]
  },
  "32026D1003": {
    availableLanguages: ["en"],
    contents: [
      {
        language: "en",
        contentType: "text/plain",
        sourceUri: "cellar:mock:32026D1003/en/text",
        body: "Council Decision sample. No Annex listed-entry changes are made."
      }
    ]
  },
  "32026R1004": {
    availableLanguages: ["fr", "de"],
    contents: [
      {
        language: "fr",
        contentType: "application/xml",
        sourceUri: "cellar:mock:32026R1004/fr/xml",
        body: `<acte celex="32026R1004" lang="fr"><annexe /></acte>`
      }
    ]
  },
  "32026R1005": new RetrievalFailure("CELLAR_UNAVAILABLE", "CELLAR retrieval failed")
};
