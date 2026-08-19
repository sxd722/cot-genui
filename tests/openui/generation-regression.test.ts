import { describe, expect, it } from "vitest";
import { createParser, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import runtimeSpec from "../../src/openui/generated/system-prompt.spec.json";
import compactGeneralSpec from "../../src/openui/generated/compact-general.spec.json";
import compactPlanningSpec from "../../src/openui/generated/compact-planning.spec.json";
import compactRecommendationSpec from "../../src/openui/generated/compact-recommendation.spec.json";
import compactAnalysisSpec from "../../src/openui/generated/compact-analysis.spec.json";
import expandedSpec from "../../src/openui/generated/expanded.spec.json";
import { CARD_PLAN_SYSTEM_PROMPT } from "../../src/lib/cardPlanPrompt";
import { resolveFeatureFlags } from "../../src/lib/featureFlags";
import { buildOpenUIBootstrap } from "../../src/openui/bootstrap";
import { containsRawExternalUrl, forbiddenOpenUIActions } from "../../src/openui/localInteraction";
import { compactPalettes, EXPANDED_PALETTE } from "../../src/openui/palettes";
import { examplesForTaskFamily } from "../../src/openui/promptOptions";
import { sampleCardPlan, sixCardPlan } from "./fixtures";

describe("initial OpenUI generation regression gate", () => {
  it("preserves flexible 1-6 topology and exact bootstrap card counts", () => {
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("可生成1-6张");
    const parser = createParser((runtimeSpec as LibrarySpec).schema as LibraryJSONSchema);
    const one = parser.parse(buildOpenUIBootstrap({ ...sampleCardPlan, cards: [sampleCardPlan.cards[0]] }).code);
    const six = parser.parse(buildOpenUIBootstrap(sixCardPlan).code);
    expect(one.root?.props.children).toHaveLength(1);
    expect(six.root?.props.children).toHaveLength(6);
  });

  it("keeps compact and expanded prompt surfaces safe and bounded", () => {
    for (const palette of compactPalettes()) {
      expect(palette.components.length).toBeGreaterThanOrEqual(16);
      expect(palette.components.length).toBeLessThanOrEqual(22);
      expect(palette.components).toEqual(expect.arrayContaining(["CardDeck", "GeneratedCard"]));
      expect(palette.components).not.toEqual(expect.arrayContaining(["Query", "Mutation"]));
    }
    expect(EXPANDED_PALETTE.components.length).toBeGreaterThan(Math.max(...compactPalettes().map((palette) => palette.components.length)));
    expect(EXPANDED_PALETTE.components).not.toEqual(expect.arrayContaining(["Query", "Mutation"]));
  });

  it("keeps asset contracts ID-only and rejects unsafe source forms", () => {
    const imageSignature = runtimeSpec.components.AssetImage.signature;
    const gallerySignature = runtimeSpec.components.AssetGallery.signature;
    expect(imageSignature).toContain("assetRef");
    expect(gallerySignature).toContain("assetRefs");
    expect(`${imageSignature} ${gallerySignature}`).not.toMatch(/src|url/i);
    expect(containsRawExternalUrl('image = AssetImage("https://example.com/a.jpg")')).toBe(true);
    expect(forbiddenOpenUIActions('x = Button("x", Action([@Run(job), @OpenUrl("x")]))')).toEqual(["Run", "OpenUrl"]);
  });

  it("parses representative artifacts from every prompt palette with the full runtime", () => {
    const familyExamples = [
      ...examplesForTaskFamily("general"), ...examplesForTaskFamily("planning"),
      ...examplesForTaskFamily("recommendation"), ...examplesForTaskFamily("analysis"),
    ];
    const parser = createParser((runtimeSpec as LibrarySpec).schema as LibraryJSONSchema);
    for (const example of familyExamples) {
      const parsed = parser.parse(example);
      expect(parsed.root?.typeName).toBe("CardDeck");
      expect(parsed.meta.errors).toEqual([]);
      expect(parsed.meta.unresolved).toEqual([]);
    }
    for (const spec of [compactGeneralSpec, compactPlanningSpec, compactRecommendationSpec, compactAnalysisSpec, expandedSpec]) {
      expect(spec.root).toBe("CardDeck");
      expect(spec.components.CardDeck).toBeDefined();
      expect(spec.components.GeneratedCard).toBeDefined();
    }
  });

  it("ships local bindings disabled by default", () => {
    expect(resolveFeatureFlags({}).OPENUI_LOCAL_BINDINGS).toBe(false);
  });
});
