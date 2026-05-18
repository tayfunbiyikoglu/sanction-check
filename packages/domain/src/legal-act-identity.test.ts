import { describe, expect, it } from "vitest";
import {
  legalActIdentityKey,
  normalizeLegalActIdentityInput,
  resolveLegalActIdentity
} from "./legal-act-identity.js";

describe("resolveLegalActIdentity", () => {
  it("prefers CELEX ID over other identifiers", () => {
    expect(
      resolveLegalActIdentity({
        celexId: " 32014r0269 ",
        cellarId: "cellar-1",
        officialUri: "https://example.test/legal-act"
      })
    ).toEqual({ kind: "CELEX", value: "32014R0269" });
  });

  it("falls back to CELLAR ID, then official URI", () => {
    expect(resolveLegalActIdentity({ cellarId: "cellar-1", officialUri: "uri-1" })).toEqual({
      kind: "CELLAR",
      value: "cellar-1"
    });

    expect(resolveLegalActIdentity({ officialUri: "uri-1" })).toEqual({
      kind: "OFFICIAL_URI",
      value: "uri-1"
    });
  });

  it("normalizes legal act identity fields before keying", () => {
    expect(
      normalizeLegalActIdentityInput({
        celexId: " 32026r1001 ",
        cellarId: " CELLAR-ABC ",
        officialUri: "HTTPS://EUR-LEX.EUROPA.EU/legal-content/EN/TXT/?uri=CELEX:32026R1001#top"
      })
    ).toEqual({
      celexId: "32026R1001",
      cellarId: "cellar-abc",
      officialUri: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R1001"
    });
  });

  it("builds a stable key from the resolved legal act identity", () => {
    expect(legalActIdentityKey(resolveLegalActIdentity({ cellarId: " CELLAR-ABC " }))).toBe(
      "CELLAR:cellar-abc"
    );
  });

  it("rejects discovery triggers without a legal act identity", () => {
    expect(() =>
      resolveLegalActIdentity({
        celexId: " ",
        cellarId: ""
      })
    ).toThrow("Candidate legal act requires CELEX ID, CELLAR ID, or official URI");
  });
});
