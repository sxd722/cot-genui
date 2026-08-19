import { describe, expect, it } from "vitest";
import { extractCardSlice, mergeOpenUIPatch } from "../src/openui/editSlice";
import { splitOpenUIStatements } from "../src/openui/statements";
import { CARD_EDIT_MODEL_PROFILES, isCardEditModelProfile } from "../src/lib/cardEditingTypes";

const fixture = `root = CardDeck([card_0, card_1])
card_0 = GeneratedCard("first", "First", [card_0_body])
card_1 = GeneratedCard("second", "Second", [card_1_body])
shared_label = TextContent("shared")
card_0_body = Stack([
  first_text,
  shared_label
], "column", "m")
first_text = TextContent("hello\\nworld")
card_1_body = Stack([second_text, shared_label], "column", "m")
second_text = TextContent("other")`;

describe("OpenUI card statement editing", () => {
  it("limits the secondary-edit selector to the two supported GLM profiles", () => {
    expect(CARD_EDIT_MODEL_PROFILES).toEqual(["glm_5_2", "glm_4_7_flash"]);
    expect(isCardEditModelProfile("glm_5_2")).toBe(true);
    expect(isCardEditModelProfile("glm_4_7_flash")).toBe(true);
    expect(isCardEditModelProfile("groq_qwen_3_6_27b")).toBe(false);
  });

  it("splits multiline statements without breaking quoted or nested content", () => {
    const statements = splitOpenUIStatements(fixture);
    expect(statements.map((statement) => statement.id)).toEqual([
      "root", "card_0", "card_1", "shared_label", "card_0_body", "first_text", "card_1_body", "second_text",
    ]);
    expect(statements.find((statement) => statement.id === "card_0_body")?.source).toContain("first_text");
  });

  it("extracts the target dependency closure and marks shared statements read-only", () => {
    const slice = extractCardSlice(fixture, 0);
    expect(slice.statementIds).toEqual(["shared_label", "card_0_body", "first_text"]);
    expect(slice.sharedIds).toEqual(["shared_label"]);
    expect(slice.editableIds).toEqual(["card_0_body", "first_text"]);
    expect(slice.source).not.toContain("second_text =");
  });

  it("merges target assignments but rejects shell or shared replacements", () => {
    const slice = extractCardSlice(fixture, 0);
    const merged = mergeOpenUIPatch(fixture, 'first_text = TextContent("edited")', new Set(slice.editableIds));
    expect(merged).toContain('first_text = TextContent("edited")');
    expect(() => mergeOpenUIPatch(fixture, 'shared_label = TextContent("bad")', new Set(slice.editableIds))).toThrow(/越界/);
    expect(() => mergeOpenUIPatch(fixture, 'root = CardDeck([])', new Set(slice.editableIds))).toThrow(/越界/);
  });

  it("allows new local helper assignments but not new shell identifiers", () => {
    const merged = mergeOpenUIPatch(fixture, 'first_badge = Badge("New")', new Set(extractCardSlice(fixture, 0).editableIds));
    expect(merged.endsWith('first_badge = Badge("New")')).toBe(true);
    expect(() => mergeOpenUIPatch(fixture, 'card_9_body = Stack([])', new Set())).toThrow(/shell/);
  });
});
