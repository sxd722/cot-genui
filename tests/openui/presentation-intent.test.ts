import { describe, expect, it } from "vitest";
import { normalizeCardPresentation } from "../../src/lib/cardPlanNormalize";

describe("CardPlan presentation intent", () => {
  it("preserves bounded presentation intent", () => {
    expect(normalizeCardPresentation({ archetype: "timeline", density: "balanced", emphasis: "content" })).toEqual({
      archetype: "timeline", density: "balanced", emphasis: "content",
    });
  });

  it("drops unknown presentation values instead of passing arbitrary style", () => {
    expect(normalizeCardPresentation({ archetype: "custom_css", density: "neon" })).toBeUndefined();
    expect(normalizeCardPresentation({ archetype: "hero", density: "neon" })).toBeUndefined();
  });
});
