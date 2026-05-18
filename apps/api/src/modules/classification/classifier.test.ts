import { describe, expect, it } from "vitest";
import { classifyCandidateSourceContent } from "./classifier.js";

describe("classifyCandidateSourceContent", () => {
  it("classifies Annex listed-entry changes as delta", () => {
    expect(
      classifyCandidateSourceContent(
        "Annex I. The following persons and entities are added to the list set out in Annex I."
      )
    ).toMatchObject({
      classification: "DELTA",
      annexFound: true,
      annexHeading: "Annex I"
    });
  });

  it("classifies strong negative evidence as no delta", () => {
    expect(
      classifyCandidateSourceContent("Council Decision sample. No Annex listed-entry changes are made.")
    ).toMatchObject({
      classification: "NO_DELTA",
      annexFound: false
    });
  });

  it("routes Annex content without clear listed-entry changes to correction", () => {
    expect(classifyCandidateSourceContent("Annex I. Official English content needing extraction correction."))
      .toMatchObject({
        classification: "UNCERTAIN_NO_DELTA",
        annexFound: true
      });
  });

  it("classifies empty source content as parsing failed", () => {
    expect(classifyCandidateSourceContent("   ")).toMatchObject({
      classification: "PARSING_FAILED",
      annexFound: false
    });
  });
});
