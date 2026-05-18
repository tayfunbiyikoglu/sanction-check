import { describe, expect, it } from "vitest";
import { selectAiSourceContent } from "./ai-extraction-service.js";

describe("AI extraction source selection", () => {
  it("keeps the annex window when Source Content is too large for fast extraction", () => {
    const prefix = "preface ".repeat(20_000);
    const annex = "Annex I listed-entry changes begin here";
    const suffix = " sanction entry".repeat(20_000);

    const content = `${prefix}${annex}${suffix}`;
    const selected = selectAiSourceContent(content);

    expect(selected.length).toBeLessThanOrEqual(70_000);
    expect(selected).toContain(annex);
    expect(selected).not.toBe(content.slice(0, 70_000));
  });

  it("leaves already-small Source Content unchanged", () => {
    const content = "Official Journal source with Annex I";

    expect(selectAiSourceContent(content)).toBe(content);
  });
});
