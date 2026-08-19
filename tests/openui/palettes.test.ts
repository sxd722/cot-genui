import { describe, expect, it } from "vitest";
import { compactPalettes, EXPANDED_PALETTE, paletteNameForTaskFamily } from "../../src/openui/palettes";

describe("OpenUI prompt palettes", () => {
  it("keeps every compact palette bounded and structurally complete", () => {
    for (const palette of compactPalettes()) {
      expect(palette.components.length).toBeGreaterThanOrEqual(16);
      expect(palette.components.length).toBeLessThanOrEqual(22);
      expect(palette.components).toContain("CardDeck");
      expect(palette.components).toContain("GeneratedCard");
      expect(palette.components).not.toContain("Query");
      expect(palette.components).not.toContain("Mutation");
    }
  });

  it("offers an expanded but still curated large-model palette", () => {
    expect(EXPANDED_PALETTE.components.length).toBeGreaterThan(Math.max(...compactPalettes().map((value) => value.components.length)));
    expect(EXPANDED_PALETTE.components.length).toBeLessThanOrEqual(40);
  });

  it("maps adjacent task families to the intended compact palette", () => {
    expect(paletteNameForTaskFamily("decision")).toBe("recommendation");
    expect(paletteNameForTaskFamily("information")).toBe("analysis");
    expect(paletteNameForTaskFamily("support")).toBe("general");
  });
});
