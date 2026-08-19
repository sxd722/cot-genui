import { describe, expect, it } from "vitest";
import { analyzeOpenUIQuality } from "../../src/openui/qualityMetrics";
import { simpleTwoCardPlan } from "./fixtures";

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
    });
  });
});
