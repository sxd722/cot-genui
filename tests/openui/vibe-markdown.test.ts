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
});
