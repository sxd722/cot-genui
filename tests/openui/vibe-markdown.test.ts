import { describe, expect, it } from "vitest";
import { cardPlanToVibeMarkdown } from "../../src/openui/vibeMarkdown";
import { sampleCardPlan } from "./fixtures";

describe("CardPlan vibe Markdown", () => {
  it("is the unique text projection with each fact and action listed once", () => {
    const markdown = cardPlanToVibeMarkdown(sampleCardPlan);

    expect(markdown).toContain("Vibe brief");
    expect(markdown).toContain("版式、层级、图表、标签、折叠、对比方式与留白可以自由发挥");
    expect(markdown.match(/### 数据/g)).toHaveLength(3);
    expect(markdown.match(/### 动作/g)).toHaveLength(3);
    expect(markdown.match(/整体最均衡/g)).toHaveLength(1);
    expect(markdown.match(/预算/g)).toHaveLength(1);
    expect(markdown.match(/`plan:compare:details`/g)).toHaveLength(1);
    expect(markdown).not.toContain("https://example.com");
  });

  it("deduplicates repeated facts and redacts URLs found inside content", () => {
    const markdown = cardPlanToVibeMarkdown({
      ...sampleCardPlan,
      cards: [{
        id: "safe",
        purpose: "安全投影",
        blocks: [
          { kind: "summary", title: "同一事实", text: "同一事实" },
          { kind: "text", title: "来源", detail: "查看 https://example.com/private 获取详情" },
        ],
      }],
    });

    expect(markdown.match(/同一事实/g)).toHaveLength(1);
    expect(markdown).toContain("[宿主外链]");
    expect(markdown).not.toContain("https://");
  });

  it("projects bounded presentation intent without prescribing components", () => {
    const markdown = cardPlanToVibeMarkdown({
      ...sampleCardPlan,
      cards: [{ ...sampleCardPlan.cards[0], presentation: { archetype: "timeline", density: "balanced", emphasis: "content" } }],
    });

    expect(markdown).toContain("### 表达意图");
    expect(markdown).toContain("- archetype: timeline");
    expect(markdown).toContain("- density: balanced");
    expect(markdown).not.toContain("archetype: Stack");
  });

  it("uses a concise heading and moves the complete purpose into the vibe section", () => {
    const purpose = "展示整体行程时间线、交通方式及关键节点，帮助用户建立全局预期。";
    const markdown = cardPlanToVibeMarkdown({
      ...sampleCardPlan,
      cards: [{ ...sampleCardPlan.cards[0], title: "旅行时间线", purpose }],
    });

    expect(markdown).toMatch(/^## 卡片 1 \/ 1 · 旅行时间线$/m);
    expect(markdown).toContain(`### 感觉与节奏\n\n主题：${purpose}`);
    expect(markdown).not.toContain(`## 卡片 1 / 1 · ${purpose}`);
  });

  it("keeps every derived card heading within ten characters", () => {
    const markdown = cardPlanToVibeMarkdown({
      ...sampleCardPlan,
      cards: [{
        ...sampleCardPlan.cards[0],
        purpose: "整合预算交通住宿餐饮活动安排与风险提醒（供最终决策使用）",
      }],
    });
    const title = markdown.match(/^## 卡片 1 \/ 1 · (.+)$/m)?.[1] ?? "";

    expect([...title].length).toBeGreaterThan(0);
    expect([...title].length).toBeLessThanOrEqual(10);
    expect(title).not.toContain("（");
  });
});
