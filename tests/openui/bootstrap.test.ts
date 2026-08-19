import { describe, expect, it } from "vitest";
import { createParser, type LibraryJSONSchema } from "@openuidev/lang-core";
import { buildOpenUIBootstrap } from "../../src/openui/bootstrap";
import librarySpec from "../../src/openui/generated/system-prompt.spec.json";
import { sampleCardPlan } from "./fixtures";

describe("OpenUI deterministic bootstrap", () => {
  it("creates stable identifiers without using arbitrary card IDs as variables", () => {
    const bootstrap = buildOpenUIBootstrap(sampleCardPlan);

    expect(bootstrap.code.split("\n")[0]).toBe("root = CardDeck([card_0, card_1, card_2])");
    expect(bootstrap.code.match(/GeneratedCard\(/g)).toHaveLength(3);
    expect(bootstrap.code).toContain('card_0 = GeneratedCard("overview/first", "先看方向", [card_0_body])');
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
});
