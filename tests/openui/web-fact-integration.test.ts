import { describe, expect, it } from "vitest";
import type { CardPlan } from "../../src/dsl/modules";
import type { InferenceState } from "../../src/lib/pipelineTypes";
import { integrateWebFactsIntoCardPlan } from "../../src/lib/webFactIntegration";

type WebEntity = NonNullable<NonNullable<InferenceState["webFacts"]>[number]["entities"]>[number];

function stateWithEntity(overrides: Partial<WebEntity> = {}): InferenceState {
  return {
    taskType: "本地推荐",
    needsContext: false,
    slotRequirements: [],
    slots: [],
    conflicts: [],
    questions: [],
    assumptions: [],
    webFacts: [{
      query: "故宫推荐",
      summary: "已核验公开信息",
      entities: [{
        name: "故宫博物院",
        description: "适合第一次到北京参观，建议提前预约。",
        sourceUrl: "https://www.dpm.org.cn/visit.html",
        actionKind: "details",
        ...overrides,
      }],
    }],
  };
}

describe("web fact integration", () => {
  it("preserves a one-card decision and merges facts and links into that card", () => {
    const plan: CardPlan = {
      skillName: "北京建议",
      reasoning: "单卡足够",
      cards: [{ id: "answer", purpose: "直接建议", blocks: [{ kind: "summary", text: "先确定核心行程。" }] }],
    };

    const integrated = integrateWebFactsIntoCardPlan(plan, stateWithEntity());

    expect(integrated.cards).toHaveLength(1);
    expect(integrated.cards[0].id).toBe("answer");
    expect(integrated.cards.some((card) => card.id.startsWith("official_resources"))).toBe(false);
    expect(integrated.cards[0].blocks.some((block) => block.kind === "list" && block.items?.some((item) => item.label === "故宫博物院"))).toBe(true);
    expect(integrated.cards[0].actions?.some((action) => action.type === "external-link" && action.link === "https://www.dpm.org.cn/visit.html")).toBe(true);
  });

  it("attaches a resource to the most relevant existing business card", () => {
    const plan: CardPlan = {
      skillName: "北京行程",
      reasoning: "两卡足够",
      cards: [
        { id: "overview", purpose: "行程概览", blocks: [{ kind: "hero", text: "北京两日游" }] },
        { id: "places", purpose: "景点推荐", blocks: [{ kind: "list", items: [{ label: "故宫博物院", detail: "核心景点" }] }] },
      ],
    };

    const integrated = integrateWebFactsIntoCardPlan(plan, stateWithEntity());

    expect(integrated.cards).toHaveLength(2);
    expect(integrated.cards[0].actions).toBeUndefined();
    expect(integrated.cards[1].actions?.[0]?.type).toBe("external-link");
  });

  it("does not exceed five blocks when the target card is already full", () => {
    const plan: CardPlan = {
      skillName: "紧凑结果",
      reasoning: "不扩卡",
      cards: [{
        id: "full",
        purpose: "完整建议",
        blocks: Array.from({ length: 5 }, (_, index) => ({ kind: "summary" as const, title: `信息${index + 1}`, text: `内容${index + 1}` })),
      }],
    };

    const integrated = integrateWebFactsIntoCardPlan(plan, stateWithEntity());

    expect(integrated.cards).toHaveLength(1);
    expect(integrated.cards[0].blocks).toHaveLength(5);
    expect(integrated.cards[0].blocks.some((block) => block.detail?.includes("故宫博物院"))).toBe(true);
  });

  it("returns the original plan when content and link are already covered", () => {
    const plan: CardPlan = {
      skillName: "已覆盖",
      reasoning: "无需补充",
      cards: [{
        id: "covered",
        purpose: "景点推荐",
        blocks: [{ kind: "summary", text: "适合第一次到北京参观，建议提前预约。" }],
        actions: [{ id: "details", label: "查看故宫", type: "external-link", link: "https://www.dpm.org.cn/visit.html" }],
      }],
    };

    expect(integrateWebFactsIntoCardPlan(plan, stateWithEntity())).toBe(plan);
  });
});
