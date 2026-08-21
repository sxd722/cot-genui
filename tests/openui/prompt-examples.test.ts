import { describe, expect, it } from "vitest";
import { createParser, generateSystemPrompt, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import compactGeneralSpec from "../../src/openui/generated/compact-general.spec.json";
import compactPlanningSpec from "../../src/openui/generated/compact-planning.spec.json";
import compactRecommendationSpec from "../../src/openui/generated/compact-recommendation.spec.json";
import compactAnalysisSpec from "../../src/openui/generated/compact-analysis.spec.json";
import { ALL_OPENUI_EXAMPLES, cotGenUIPromptOptions, examplesForTaskFamily } from "../../src/openui/promptOptions";

const FULL_BASELINE_PROMPT_CHARS = 23_845;

function componentNames(examples: string[]) {
  return new Set(examples.flatMap((example) => [...example.matchAll(/=\s*([A-Z][A-Za-z0-9]*)\s*\(/g)].map((match) => match[1])));
}

function rootCardCount(example: string): number {
  return example.match(/^root\s*=\s*CardDeck\(\[([^\]]*)\]/m)?.[1].split(",").filter((value) => value.trim()).length ?? 0;
}

describe("task-specific OpenUI composition examples", () => {
  it("covers diverse topology and semantic composition", () => {
    expect(ALL_OPENUI_EXAMPLES.length).toBeGreaterThanOrEqual(8);
    expect(componentNames(ALL_OPENUI_EXAMPLES).size).toBeGreaterThanOrEqual(10);
    expect(ALL_OPENUI_EXAMPLES.some((value) => rootCardCount(value) === 1)).toBe(true);
    expect(ALL_OPENUI_EXAMPLES.some((value) => rootCardCount(value) === 2)).toBe(true);
    expect(ALL_OPENUI_EXAMPLES.some((value) => rootCardCount(value) >= 4)).toBe(true);
  });

  it("gives each routed family two compact and safe examples", () => {
    const specs = { general: compactGeneralSpec, planning: compactPlanningSpec, recommendation: compactRecommendationSpec, analysis: compactAnalysisSpec };
    for (const family of ["general", "planning", "recommendation", "analysis"] as const) {
      const examples = examplesForTaskFamily(family);
      expect(examples).toHaveLength(2);
      expect(examples.join("\n")).not.toMatch(/Query\(|Mutation\(|@Run|@OpenUrl|https?:\/\//);
      const parser = createParser(specs[family].schema as LibraryJSONSchema);
      for (const example of examples) {
        const parsed = parser.parse(example);
        expect(parsed.root?.typeName).toBe("CardDeck");
        expect(parsed.meta.errors).toEqual([]);
        expect(parsed.meta.unresolved).toEqual([]);
      }
    }
  });

  it("demonstrates role-appropriate media composition in relevant routed families", () => {
    expect(examplesForTaskFamily("planning").join("\n")).toContain("MediaHero");
    expect(examplesForTaskFamily("recommendation").join("\n")).toMatch(/RecommendationGrid\([^\n]*assetRef/);
    expect(examplesForTaskFamily("recommendation").join("\n")).toContain("MediaHero");
    expect(examplesForTaskFamily("analysis").join("\n")).toContain("AssetImage");
  });

  it("keeps a compact prompt below the captured full-library baseline", () => {
    const prompt = generateSystemPrompt({ library: compactGeneralSpec as LibrarySpec, promptOptions: { ...cotGenUIPromptOptions, examples: examplesForTaskFamily("general") } });
    expect(prompt.length).toBeLessThan(FULL_BASELINE_PROMPT_CHARS);
  });
});
