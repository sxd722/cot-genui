import { describe, expect, it } from "vitest";
import { CARD_PLAN_SYSTEM_PROMPT } from "../../src/lib/cardPlanPrompt";
import { cotGenUIPromptOptions } from "../../src/openui/promptOptions";
import { cardPlanToVibeMarkdown } from "../../src/openui/vibeMarkdown";
import { sampleCardPlan } from "./fixtures";

describe("adaptive CardPlan card count", () => {
  it("lets the CardPlan model choose one to six cards and favors one card for simple intents", () => {
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("可生成1-6张");
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("简单意图优先用1张完整卡解决");
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("不要为了凑数量");
    expect(CARD_PLAN_SYSTEM_PROMPT).not.toContain("生成3-6张卡");
  });

  it("does not bias OpenUI toward multiple cards after CardPlan chose the count", () => {
    expect(cotGenUIPromptOptions.preamble).not.toMatch(/multi-card/i);
    expect(cotGenUIPromptOptions.additionalRules?.join(" ")).toContain("one card or several cards");
    expect(cotGenUIPromptOptions.additionalRules?.join(" ")).toContain("requiredShell is the sole source of truth");
  });

  it("describes a one-card plan as a complete single-card experience", () => {
    const markdown = cardPlanToVibeMarkdown({ ...sampleCardPlan, cards: [sampleCardPlan.cards[0]] });

    expect(markdown).toContain("单卡体验");
    expect(markdown).toContain("直接、完整地解决用户意图");
    expect(markdown).not.toContain("平级卡片");
  });
});
