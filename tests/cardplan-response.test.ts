import { describe, expect, it } from "vitest";
import { normalizeCardPlanEnvelope } from "../src/lib/cardPlanResponse";

describe("CardPlan model response normalization", () => {
  it("accepts the canonical response envelope", () => {
    const result = normalizeCardPlanEnvelope({
      reasoning: "外层说明",
      cardPlan: {
        skillName: "旅行规划",
        reasoning: "按天组织",
        cards: [{ id: "day_1", title: "第一天", purpose: "安排第一天", blocks: [] }],
      },
    }, { skillName: "备用名称", reasoning: "备用说明" });

    expect(result.plan).toMatchObject({ skillName: "旅行规划", reasoning: "按天组织" });
    expect(result.diagnostics).toMatchObject({ valid: true, source: "cardPlan", repairs: [] });
  });

  it("repairs common lightweight-model envelope and required-field drift", () => {
    const result = normalizeCardPlanEnvelope({
      reasoning: "外层说明",
      card_plan: {
        name: "酒店推荐",
        cards: [{ title: "酒店一", blocks: [{ kind: "summary", text: "临海酒店" }] }],
      },
    }, { skillName: "备用名称", reasoning: "备用说明" });

    expect(result.plan).toMatchObject({
      skillName: "酒店推荐",
      reasoning: "外层说明",
      cards: [{ id: "card_1", title: "酒店一", purpose: "酒店一" }],
    });
    expect(result.diagnostics.valid).toBe(true);
    expect(result.diagnostics.source).toBe("card_plan");
    expect(result.diagnostics.repairs).toEqual(expect.arrayContaining([
      "skillName_from_name",
      "reasoning_from_outer",
      "card_1_id_synthesized",
      "card_1_purpose_from_title",
    ]));
  });

  it("reports actionable issues when no usable card array exists", () => {
    const result = normalizeCardPlanEnvelope({ reasoning: "没有计划", cardPlan: { skillName: "空计划" } }, {
      skillName: "备用名称",
      reasoning: "备用说明",
    });

    expect(result.plan).toBeNull();
    expect(result.diagnostics).toMatchObject({ valid: false, source: "cardPlan" });
    expect(result.diagnostics.issues).toContain("cards_missing_or_empty");
  });
});
