import { describe, expect, it } from "vitest";
import { createParser, type LibraryJSONSchema } from "@openuidev/lang-core";
import { buildOpenUIBootstrap } from "../../src/openui/bootstrap";
import librarySpec from "../../src/openui/generated/system-prompt.spec.json";
import { sampleCardPlan } from "./fixtures";

describe("OpenUI deterministic bootstrap", () => {
  it("creates stable identifiers without using arbitrary card IDs as variables", () => {
    const bootstrap = buildOpenUIBootstrap(sampleCardPlan);

    expect(bootstrap.code.split("\n")[0]).toBe('root = CardDeck([card_0, card_1, card_2], "deck")');
    expect(bootstrap.code.match(/GeneratedCard\(/g)).toHaveLength(3);
    expect(bootstrap.code).toContain('card_0 = GeneratedCard("overview/first", "先看方向", [card_0_body], "standard", "balanced")');
    expect(bootstrap.code).not.toContain("overview/first =");
    expect(bootstrap.bodyRefs.map((item) => item.bodyRef)).toEqual(["card_0_body", "card_1_body", "card_2_body"]);
  });

  it("already exposes a renderable CardDeck while body refs are unresolved", () => {
    const bootstrap = buildOpenUIBootstrap(sampleCardPlan);
    const parser = createParser(librarySpec.schema as LibraryJSONSchema);
    const parsed = parser.parse(bootstrap.code);

    expect(parsed.root?.typeName).toBe("CardDeck");
    expect(parsed.root?.props.children).toHaveLength(3);
    expect(parsed.meta.unresolved).toEqual(["card_0_body", "card_1_body", "card_2_body"]);
  });

  it("maps CardPlan presentation intent into bounded host shell props", () => {
    const bootstrap = buildOpenUIBootstrap({
      ...sampleCardPlan,
      cards: [
        { ...sampleCardPlan.cards[0], id: "hero", purpose: "主结论", presentation: { archetype: "hero", density: "immersive" } },
        { ...sampleCardPlan.cards[1], id: "metrics", purpose: "关键数据", presentation: { archetype: "data", density: "compact" } },
        sampleCardPlan.cards[2],
      ],
    });
    expect(bootstrap.code).toContain('root = CardDeck([card_0, card_1, card_2], "featured")');
    expect(bootstrap.code).toContain('GeneratedCard("hero", "主结论", [card_0_body], "hero", "immersive")');
    expect(bootstrap.code).toContain('GeneratedCard("metrics", "关键数据", [card_1_body], "data", "compact")');
  });

  it("uses the same concise title as CardPlan Markdown while preserving purpose outside the shell", () => {
    const bootstrap = buildOpenUIBootstrap({
      ...sampleCardPlan,
      cards: [{
        ...sampleCardPlan.cards[0],
        title: "旅行时间线",
        purpose: "展示整体行程时间线、交通方式及关键节点，帮助用户建立全局预期。",
      }],
    });

    expect(bootstrap.code).toContain('GeneratedCard("overview/first", "旅行时间线", [card_0_body]');
    expect(bootstrap.code).not.toContain("帮助用户建立全局预期");
  });
});
