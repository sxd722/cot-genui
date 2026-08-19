import { describe, expect, it } from "vitest";
import librarySpec from "../../src/openui/generated/system-prompt.spec.json";
import { cotGenUILibrary } from "../../src/openui/library";

describe("cot-genui OpenUI library", () => {
  it("uses CardDeck as the single generated root", () => {
    expect(cotGenUILibrary.root).toBe("CardDeck");
    expect(cotGenUILibrary.components.GeneratedCard).toBeDefined();
    expect(cotGenUILibrary.components.HostActionMenu).toBeDefined();
    expect(cotGenUILibrary.components.MediaActionTile).toBeDefined();
    for (const name of ["MetricRow", "Timeline", "RecommendationGrid", "ComparisonGrid", "MediaHero", "ActionPanel"]) {
      expect(cotGenUILibrary.components[name]).toBeDefined();
    }
  });

  it("keeps the generated backend spec aligned with the browser library", () => {
    expect(librarySpec.root).toBe(cotGenUILibrary.root);
    expect(Object.keys(librarySpec.components).sort()).toEqual(Object.keys(cotGenUILibrary.components).sort());
  });
});
