import { describe, expect, it } from "vitest";
import type { CardPlan } from "../../src/dsl/modules";
import { sanitizeCardPlanExternalLinks } from "../../src/lib/webFactIntegration";
import { CARD_PLAN_SYSTEM_PROMPT } from "../../src/lib/cardPlanPrompt";

describe("optional web fact evidence", () => {
  it("never adds content, actions, or cards just because web facts exist", () => {
    const plan: CardPlan = {
      skillName: "简单任务",
      reasoning: "一张卡足够",
      cards: [{ id: "answer", purpose: "直接建议", blocks: [{ kind: "summary", text: "完成今天的三件事。" }] }],
    };

    const sanitized = sanitizeCardPlanExternalLinks(plan, new Set(["https://example.com/details"]));

    expect(sanitized.cards).toHaveLength(1);
    expect(sanitized.cards[0].blocks).toEqual(plan.cards[0].blocks);
    expect(sanitized.cards[0].actions).toBeUndefined();
  });

  it("keeps only model-selected external links present in the provider registry", () => {
    const plan: CardPlan = {
      skillName: "餐厅建议",
      reasoning: "保留安全入口",
      cards: [{
        id: "restaurants",
        purpose: "餐厅选择",
        blocks: [{ kind: "list", items: [{ label: "A 餐厅" }] }],
        actions: [
          { id: "safe", label: "查看详情", type: "external-link", link: "https://example.com/details" },
          { id: "invented", label: "未知链接", type: "external-link", link: "https://invented.example/path" },
          { id: "confirm", label: "确认", type: "confirm" },
        ],
      }],
    };

    const sanitized = sanitizeCardPlanExternalLinks(plan, new Set(["https://example.com/details"]));

    expect(sanitized.cards[0].actions?.map((action) => action.id)).toEqual(["safe", "confirm"]);
  });

  it("describes web facts as optional and does not require coverage", () => {
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("可选的外部证据池");
    expect(CARD_PLAN_SYSTEM_PROMPT).toContain("可以完全忽略");
    expect(CARD_PLAN_SYSTEM_PROMPT).not.toContain("必须把具体实体");
  });
});
