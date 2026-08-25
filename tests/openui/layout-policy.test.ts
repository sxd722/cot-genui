import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createParser, type ElementNode, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import type { CardPlan } from "../../src/dsl/modules";
import { cardPlanSystemPromptFor } from "../../src/lib/cardPlanPrompt";
import { buildOpenUIBootstrap } from "../../src/openui/bootstrap";
import { buildOpenUIDesignBrief } from "../../src/openui/designBrief";
import { buildDeterministicFixedOpenUI } from "../../src/openui/fixedArtifact";
import { openUISystemPromptFor } from "../../src/openui/promptRouting";
import runtimeSpec from "../../src/openui/generated/system-prompt.spec.json";
import {
  DEFAULT_CARD_LAYOUT_MODE,
  fitCardPlanToLayout,
  fixedOpenUILayoutPrompt,
} from "../../src/openui/layoutPolicy";
import { validateOpenUILayout } from "../../src/openui/layoutValidation";
import { cardPlanToVibeMarkdown } from "../../src/openui/vibeMarkdown";

function fixedPlan(blocks: CardPlan["cards"][number]["blocks"]): CardPlan {
  return {
    skillName: "固定布局",
    reasoning: "在固定画布内展示关键信息。",
    layoutPolicy: { mode: "fixed-600x300", cardWidth: 600, cardHeight: 300, overflow: "forbid", innerScroll: false },
    cards: [{ id: "overview", title: "主要结论", purpose: "展示主要结论", blocks }],
  };
}

function parsedCards(code: string): ElementNode[] {
  const parser = createParser((runtimeSpec as LibrarySpec).schema as LibraryJSONSchema);
  const children = parser.parse(code).root?.props.children;
  return Array.isArray(children)
    ? children.filter((item): item is ElementNode => !!item && typeof item === "object" && (item as Partial<ElementNode>).type === "element")
    : [];
}

describe("fixed and free CardPlan layout modes", () => {
  it("defaults new requests to fixed cards and gives both models explicit constraints", () => {
    expect(DEFAULT_CARD_LAYOUT_MODE).toBe("fixed-600x300");
    expect(cardPlanSystemPromptFor("fixed-600x300")).toContain("600×300px");
    expect(cardPlanSystemPromptFor("fixed-600x300")).toContain("每卡最多2个内容块");
    expect(fixedOpenUILayoutPrompt("fixed-600x300")).toContain("card-internal scrolling is forbidden");
    expect(fixedOpenUILayoutPrompt("free")).toBe("");
  });

  it("splits an overfull list at semantic item boundaries without losing items", () => {
    const labels = ["一", "二", "三", "四", "五"];
    const fitted = fitCardPlanToLayout(fixedPlan([{ kind: "list", title: "项目", items: labels.map((label) => ({ label })) }]), "fixed-600x300");

    expect(fitted.plan.cards).toHaveLength(2);
    expect(fitted.diagnostics.splitCards).toEqual([{ sourceCardId: "overview", generatedCardIds: ["overview", "overview__2"] }]);
    expect(fitted.plan.cards.flatMap((card) => card.blocks.flatMap((block) => block.items ?? []).map((item) => item.label))).toEqual(labels);
    expect(fitted.diagnostics.valid).toBe(true);
  });

  it("keeps free mode topology and density untouched", () => {
    const plan = fixedPlan([{ kind: "summary", text: "简短结论" }]);
    plan.cards[0].presentation = { archetype: "hero", density: "immersive" };
    const fitted = fitCardPlanToLayout(plan, "free");

    expect(fitted.plan.cards).toHaveLength(1);
    expect(fitted.plan.cards[0].presentation?.density).toBe("immersive");
    expect(fitted.plan.layoutPolicy).toEqual({ mode: "free" });
  });

  it("keeps more than six fixed cards without applying a count ceiling", () => {
    const base = fixedPlan([{ kind: "summary", text: "简短结论" }]);
    const plan = { ...base, cards: Array.from({ length: 12 }, (_, index) => ({ ...base.cards[0], id: `card_${index + 1}` })) };
    const fitted = fitCardPlanToLayout(plan, "fixed-600x300");

    expect(fitted.plan.cards).toHaveLength(12);
    expect(fitted.diagnostics.finalCardCount).toBe(12);
    expect(fitted.diagnostics.valid).toBe(true);
  });

  it("projects the fixed policy into Markdown, design brief, and deterministic shell", () => {
    const plan = fixedPlan([{ kind: "summary", text: "简短结论" }]);
    const markdown = cardPlanToVibeMarkdown(plan);
    const brief = buildOpenUIDesignBrief(plan);
    const shell = buildOpenUIBootstrap(plan).code;

    expect(markdown).toContain("固定卡片 **600×300px**");
    expect(markdown).toContain("卡内不可滚动");
    expect(brief.layout).toMatchObject({ mode: "fixed-600x300", cardWidth: 600, cardHeight: 300, innerScroll: false });
    expect(shell).toContain('root = CardDeck([card_0], "deck")');
    expect(shell).toContain('"compact")');
  });

  it("accepts a compact artifact and rejects high-risk fixed-canvas components", () => {
    const plan = fixedPlan([{ kind: "summary", text: "简短结论" }]);
    const validCode = [
      'root = CardDeck([card], "deck")',
      'card = GeneratedCard("overview", "主要结论", [body], "standard", "compact")',
      'facts = FixedFacts(["简短结论"])',
      'body = FixedCardContent([facts])',
    ].join("\n");
    const invalidCode = [
      'root = CardDeck([card], "deck")',
      'card = GeneratedCard("overview", "主要结论", [body], "standard", "compact")',
      'body = CodeBlock("text", "一段不适合固定卡片的长代码")',
    ].join("\n");

    expect(validateOpenUILayout(parsedCards(validCode), plan)).toMatchObject({ valid: true, checkedCards: 1, withinBudget: 1 });
    const invalid = validateOpenUILayout(parsedCards(invalidCode), plan);
    expect(invalid.valid).toBe(false);
    expect(invalid.violations[0].reasons.join(" ")).toContain("CodeBlock");
  });

  it("splits long prose without losing its source text", () => {
    const source = "这是第一句，需要完整保留。".repeat(35) + "Supercalifragilisticexpialidocious".repeat(15);
    const fitted = fitCardPlanToLayout(fixedPlan([{ kind: "summary", text: source }]), "fixed-600x300");
    const reconstructed = fitted.plan.cards.flatMap((card) => card.blocks.map((block) => block.text ?? "")).join("");

    expect(fitted.plan.cards.length).toBeGreaterThan(1);
    expect(reconstructed).toBe(source);
    expect(fitted.diagnostics.valid).toBe(true);
  });

  it("moves more than two actions into stable continuation cards without changing action ids", () => {
    const plan = fixedPlan([{ kind: "summary", text: "保留主要结论" }]);
    plan.cards[0].actions = Array.from({ length: 5 }, (_, index) => ({
      id: `action_${index + 1}`,
      label: `动作 ${index + 1}`,
      type: "navigate" as const,
      targetCardId: "overview",
    }));
    const fitted = fitCardPlanToLayout(plan, "fixed-600x300");

    expect(fitted.plan.cards.map((card) => card.id)).toEqual(["overview", "overview__actions_1", "overview__actions_2", "overview__actions_3"]);
    expect(fitted.plan.cards.flatMap((card) => card.actions ?? []).map((action) => action.id)).toEqual([
      "action_1", "action_2", "action_3", "action_4", "action_5",
    ]);
    expect(fitted.plan.cards.every((card) => (card.actions?.length ?? 0) <= 2)).toBe(true);
  });

  it("splits a long list item while retaining its selection flow, source slots, and media request exactly once", () => {
    const detail = "很长的列表详情需要按语义空间继续展示。".repeat(30);
    const request = { kind: "image" as const, query: "杭州西溪湿地酒店实景", count: 1, role: "hero" as const, aspect: "wide" as const };
    const plan = fixedPlan([{
      kind: "list",
      sourceSlots: ["destination"],
      assetRequest: request,
      items: [{ label: "杭州西溪", detail, onSelect: { writeTo: "hotel", value: "hangzhou", thenGoTo: "overview" } }],
    }]);
    const fitted = fitCardPlanToLayout(plan, "fixed-600x300");
    const blocks = fitted.plan.cards.flatMap((card) => card.blocks);
    const items = blocks.flatMap((block) => block.items ?? []);

    expect(items.map((item) => item.label).join("")).toBe("杭州西溪");
    expect(items.map((item) => item.detail ?? "").join("")).toBe(detail);
    expect(items.filter((item) => item.onSelect)).toHaveLength(1);
    expect(items.find((item) => item.onSelect)?.onSelect).toEqual({ writeTo: "hotel", value: "hangzhou", thenGoTo: "overview" });
    expect(blocks.every((block) => block.sourceSlots?.includes("destination"))).toBe(true);
    expect(blocks.filter((block) => block.assetRequest)).toHaveLength(1);
    expect(blocks.find((block) => block.assetRequest)?.assetRequest).toEqual(request);
    expect(fitted.diagnostics.valid).toBe(true);
  });

  it("ships exact host dimensions and no card-internal scrolling", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain('data-card-layout="fixed-600x300"');
    expect(css).toMatch(/width:\s*600px/);
    expect(css).toMatch(/height:\s*300px/);
    expect(css).toContain("overflow: hidden");
  });

  it("routes fixed mode to a bounded component spec without free-layout components", () => {
    const routed = openUISystemPromptFor({ taskFamily: "analysis", modelProfile: "glm_5_2", layoutMode: "fixed-600x300" });

    expect(routed.promptProfile).toBe("fixed:600x300");
    expect(routed.prompt).toContain("FixedCardContent");
    expect(routed.prompt).toContain("FixedTimeline");
    expect(routed.prompt).not.toContain("CodeBlock(");
    expect(routed.prompt).not.toContain("Table(");
    expect(routed.prompt).not.toContain("Accordion(");
  });

  it("builds a statically valid deterministic fallback without dropping facts or actions", () => {
    const plan = fixedPlan([
      { kind: "summary", text: "第一项事实" },
      { kind: "list", items: [{ label: "第二项", detail: "补充事实" }, { label: "第三项" }] },
    ]);
    plan.cards[0].actions = [
      { id: "confirm", label: "确认", type: "navigate", targetCardId: "overview" },
      { id: "copy", label: "复制", type: "copy", copyText: "内容" },
    ];
    const code = buildDeterministicFixedOpenUI(plan);

    expect(code).toContain("第一项事实");
    expect(code).toContain("第二项 — 补充事实");
    expect(code).toContain("第三项");
    expect(code).toContain("plan:overview:confirm");
    expect(code).toContain("plan:overview:copy");
    expect(validateOpenUILayout(parsedCards(code), plan).valid).toBe(true);
  });
});
