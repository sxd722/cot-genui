import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CardPlan } from "../../src/dsl/modules";
import { buildOpenUIDesignBrief } from "../../src/openui/designBrief";
import { describeDesignLeakage, detectDesignMetadataLeakage } from "../../src/openui/designLeakage";
import { buildOpenUIRepairPayload } from "../../src/openui/payload";

const plan: CardPlan = {
  skillName: "住宿建议",
  reasoning: "内部设计说明",
  cards: [{
    id: "hotel",
    purpose: "住宿推荐",
    presentation: { archetype: "media", density: "balanced", emphasis: "media" },
    blocks: [{ kind: "summary", title: "住宿建议", text: "优先选择靠近地铁的酒店。" }],
    actions: [{ id: "details", label: "查看详情", type: "llm-call", role: "primary" }],
  }],
};

const designBrief = buildOpenUIDesignBrief(plan, { requests: [], assets: [] });

function program(body: string): string {
  return `root = CardDeck([card], "auto")
card = GeneratedCard("hotel", "住宿推荐", [content, action], "media", "balanced")
content = TextContent(${JSON.stringify(body)})
action = HostActionChip("查看详情", "plan:hotel:details")`;
}

describe("OpenUI design-metadata leakage", () => {
  it("rejects a visible authoring heading", () => {
    const hits = detectDesignMetadataLeakage({
      openuiCode: program("感觉与节奏"),
      cardPlan: plan,
      designBrief,
    });

    expect(describeDesignLeakage(hits)).toContain("DESIGN_META_LEAK");
    expect(describeDesignLeakage(hits)).toContain("感觉与节奏");
  });

  it("rejects a visible design enum dump", () => {
    const hits = detectDesignMetadataLeakage({
      openuiCode: program("archetype: media"),
      cardPlan: plan,
      designBrief,
    });

    expect(hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "design_enum", value: "archetype: media" }),
    ]));
  });

  it.each(["数据概览", "媒体资源"])("does not reject legitimate user copy: %s", (body) => {
    expect(detectDesignMetadataLeakage({ openuiCode: program(body), cardPlan: plan, designBrief })).toEqual([]);
  });

  it("does not mistake a HostAction actionRef for visible text", () => {
    const code = program("优先选择靠近地铁的酒店。");

    expect(detectDesignMetadataLeakage({ openuiCode: code, cardPlan: plan, designBrief })).toEqual([]);
  });

  it("does not mistake a Button @ToAssistant actionRef for visible text", () => {
    const code = `root = CardDeck([card], "auto")
card = GeneratedCard("hotel", "住宿推荐", [content, action], "media", "balanced")
content = TextContent("优先选择靠近地铁的酒店。")
action = Button("查看详情", Action([@ToAssistant("plan:hotel:details")]))`;

    expect(detectDesignMetadataLeakage({ openuiCode: code, cardPlan: plan, designBrief })).toEqual([]);
  });

  it("still rejects an actionRef rendered through a text component", () => {
    expect(detectDesignMetadataLeakage({
      openuiCode: program("plan:hotel:details"),
      cardPlan: plan,
      designBrief,
    })).toEqual([expect.objectContaining({ kind: "internal_identifier", cardId: "hotel" })]);
  });

  it("passes the leakage error to the existing repair payload", () => {
    const code = program("整体创作方向");
    const leakageError = describeDesignLeakage(detectDesignMetadataLeakage({ openuiCode: code, cardPlan: plan, designBrief }));
    const validation = {
      valid: false,
      errors: [leakageError],
      coverage: { required: 2, matched: 2, missing: [] },
      assetCoverage: { valid: true, required: 0, matched: 0, missing: [], errors: [] },
      layoutCoverage: { mode: "free" as const, valid: true, checkedCards: 0, withinBudget: 0, violations: [] },
      parser: { statements: 4, unresolved: [], orphaned: [], incomplete: false },
    };
    const payload = buildOpenUIRepairPayload(plan, code, validation);

    expect(payload.validationErrors.join("\n")).toContain("DESIGN_META_LEAK");
    expect(payload).not.toHaveProperty("designBrief");
  });

  it("is wired into the artifact validator", () => {
    const validatorSource = readFileSync(resolve(process.cwd(), "src/lib/openui.ts"), "utf8");

    expect(validatorSource).toContain("detectDesignMetadataLeakage({ openuiCode: code, cardPlan, designBrief })");
    expect(validatorSource).toContain("errors.push(describeDesignLeakage(designLeaks))");
  });
});
