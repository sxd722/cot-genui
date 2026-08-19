import { describe, expect, it } from "vitest";
import { CARD_PLAN_SYSTEM_PROMPT } from "../../src/lib/cardPlanPrompt";
import { cotGenUIPromptOptions } from "../../src/openui/promptOptions";
import { cardPlanToVibeMarkdown } from "../../src/openui/vibeMarkdown";
import { sampleCardPlan } from "./fixtures";

describe("adaptive CardPlan card count", () => {
  it("lets the CardPlan model choose one to six cards and favors one card for simple intents", () => {
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("可生成1-6张");
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("简单意图优先用1张完整卡解决");
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("卡片数量没有默认值");
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("1、2、3、4、5、6");
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("概览 / 详情 / 下一步");
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("先判断需要几个独立用户界面");
    expect(CARD_PLAN_SYSTEM_PROMPT).not.toContain("生成3-6张卡");
  });

  it("does not bias OpenUI toward multiple cards after CardPlan chose the count", () => {
    expect(cotGenUIPromptOptions.preamble).not.toMatch(/multi-card/i);
    expect(cotGenUIPromptOptions.additionalRules?.join(" ")).toContain("one card or several cards");
    expect(cotGenUIPromptOptions.additionalRules?.join(" ")).toContain("requiredShell is the sole source of truth");
    const examples = cotGenUIPromptOptions.examples ?? [];
    expect(examples.length).toBeGreaterThanOrEqual(4);
    expect(examples.some((value) => value.includes("CardDeck([card_0],"))).toBe(true);
    expect(examples.some((value) => value.includes("CardDeck([card_0, card_1],"))).toBe(true);
    expect(examples.some((value) => value.includes("card_3"))).toBe(true);
  });

  it("describes a one-card plan as a complete single-card experience", () => {
    const markdown = cardPlanToVibeMarkdown({ ...sampleCardPlan, cards: [sampleCardPlan.cards[0]] });

    expect(markdown).toContain("单卡体验");
    expect(markdown).toContain("直接、完整地解决用户意图");
    expect(markdown).not.toContain("平级卡片");
  });
});
