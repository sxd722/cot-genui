import { describe, expect, it } from "vitest";
import { analyzeOpenUIQuality } from "../../src/openui/qualityMetrics";
import { simpleTwoCardPlan } from "./fixtures";
import type { AssetManifest } from "../../src/openui/assetTypes";

const code = `root = CardDeck([card_0, card_1])
card_0 = GeneratedCard("a", "A", [body_a])
card_1 = GeneratedCard("b", "B", [body_b])
body_a = Stack([title_a, callout_a], "column", "m")
title_a = TextContent("结论")
callout_a = Callout("info", "提示", "保留余量")
body_b = Stack([table_b], "column", "m")
table_b = Table([option_col, reason_col])
option_col = Col("方案", ["A", "B"])
reason_col = Col("原因", ["均衡", "灵活"])`;

const manifest: AssetManifest = {
  requests: [
    { id: "asset_a", cardId: "a", kind: "image", query: "A", count: 1, role: "hero" },
    { id: "asset_b", cardId: "b", kind: "image", query: "B", count: 1, role: "supporting" },
  ],
  assets: [
    { id: "asset_a", kind: "image", src: "https://cdn.example/a.jpg", alt: "A" },
    { id: "asset_b", kind: "image", src: "https://cdn.example/b.jpg", alt: "B" },
  ],
};

describe("OpenUI quality metrics", () => {
  it("counts cards and component diversity", () => {
    const value = analyzeOpenUIQuality(code, simpleTwoCardPlan());
    expect(value.cardCount).toBe(2);
    expect(value.uniqueComponents).toContain("Table");
    expect(value.uniqueComponentCount).toBeGreaterThan(3);
  });

  it("reports primitive ratio rather than only total statements", () => {
    const value = analyzeOpenUIQuality(code, simpleTwoCardPlan());
    expect(value.primitiveRatio).toBeGreaterThan(0);
    expect(value.primitiveRatio).toBeLessThan(1);
  });

  it("returns zeroed metrics for incomplete source", () => {
    expect(analyzeOpenUIQuality("root = CardDeck([", simpleTwoCardPlan())).toEqual({
      cardCount: 0, uniqueComponents: [], uniqueComponentCount: 0,
      primitiveStatementCount: 0, semanticStatementCount: 0, primitiveRatio: 0,
      mediaComponentCount: 0, interactionComponentCount: 0, generatedCardVariants: [],
      assetUsage: {
        available: 0, referenced: 0, resolved: 0,
        cardsWithAvailableAssets: 0, cardsUsingAssets: 0,
        unusedAssetRefs: [], status: "not-available",
      },
    });
  });

  it("distinguishes unavailable, unused, partial and fully used accepted assets", () => {
    expect(analyzeOpenUIQuality(code, simpleTwoCardPlan()).assetUsage.status).toBe("not-available");

    const unused = analyzeOpenUIQuality(code, simpleTwoCardPlan(), manifest).assetUsage;
    expect(unused).toMatchObject({
      available: 2, referenced: 0, resolved: 0,
      cardsWithAvailableAssets: 2, cardsUsingAssets: 0,
      unusedAssetRefs: ["asset_a", "asset_b"], status: "available-unused",
      diagnosticCode: "step6_did_not_select_asset",
    });

    const partialCode = `${code}\nimage_a = AssetImage("asset_a")\ncard_0 = GeneratedCard("a", "A", [body_a, image_a])`;
    const partial = analyzeOpenUIQuality(partialCode, simpleTwoCardPlan(), manifest).assetUsage;
    expect(partial).toMatchObject({
      available: 2, referenced: 1, resolved: 1,
      cardsWithAvailableAssets: 2, cardsUsingAssets: 1,
      unusedAssetRefs: ["asset_b"], status: "partial",
    });

    const usedCode = `${code}\nimage_a = AssetImage("asset_a")\nimage_b = AssetImage("asset_b")\ncard_0 = GeneratedCard("a", "A", [body_a, image_a])\ncard_1 = GeneratedCard("b", "B", [body_b, image_b])`;
    const used = analyzeOpenUIQuality(usedCode, simpleTwoCardPlan(), manifest).assetUsage;
    expect(used).toMatchObject({
      available: 2, referenced: 2, resolved: 2,
      cardsWithAvailableAssets: 2, cardsUsingAssets: 2,
      unusedAssetRefs: [], status: "used",
    });
  });

  it("does not count an invented ref as a resolved host image", () => {
    const inventedCode = `${code}\ninvented = AssetImage("asset_invented")\ncard_0 = GeneratedCard("a", "A", [body_a, invented])`;
    expect(analyzeOpenUIQuality(inventedCode, simpleTwoCardPlan(), manifest).assetUsage).toMatchObject({
      referenced: 1, resolved: 0, status: "available-unused",
    });
  });
});
