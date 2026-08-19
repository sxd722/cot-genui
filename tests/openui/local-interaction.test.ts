import { describe, expect, it } from "vitest";
import { createParser, generateSystemPrompt, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import librarySpec from "../../src/openui/generated/system-prompt.spec.json";
import { resolveFeatureFlags } from "../../src/lib/featureFlags";
import { ALLOWED_LOCAL_ACTIONS, forbiddenOpenUIActions, FORBIDDEN_OPENUI_ACTIONS } from "../../src/openui/localInteraction";
import { createCotGenUIPromptOptions } from "../../src/openui/promptOptions";

const localFixture = `$selected = "A"
root = CardDeck([card_0], "auto")
card_0 = GeneratedCard("choice", "选择", [body], "action", "compact")
body = Stack([value, buttons], "column", "m")
value = TextContent($selected)
buttons = Buttons([choose_a, choose_b])
choose_a = Button("选择 A", Action([@Set($selected, "A")]), "secondary")
choose_b = Button("选择 B", Action([@Set($selected, "B")]), "secondary")`;

describe("safe local OpenUI interaction", () => {
  it("is disabled by default and explicitly enabled by env", () => {
    expect(resolveFeatureFlags({}).OPENUI_LOCAL_BINDINGS).toBe(false);
    expect(resolveFeatureFlags({ NEXT_PUBLIC_OPENUI_LOCAL_BINDINGS: "true" }).OPENUI_LOCAL_BINDINGS).toBe(true);
  });

  it("keeps local actions separate from forbidden side effects", () => {
    expect([...ALLOWED_LOCAL_ACTIONS]).toEqual(["Set", "Reset", "ToAssistant"]);
    expect([...FORBIDDEN_OPENUI_ACTIONS]).toEqual(["Run", "OpenUrl"]);
    expect(forbiddenOpenUIActions(localFixture)).toEqual([]);
    expect(forbiddenOpenUIActions('x = Button("bad", Action([@Run(job), @OpenUrl("x")]))')).toEqual(["Run", "OpenUrl"]);
  });

  it("parses supported local state without tools", () => {
    const parsed = createParser((librarySpec as LibrarySpec).schema as LibraryJSONSchema).parse(localFixture);
    expect(parsed.root?.typeName).toBe("CardDeck");
    expect(parsed.queryStatements).toHaveLength(0);
    expect(parsed.mutationStatements).toHaveLength(0);
    expect(parsed.meta.errors).toEqual([]);
  });

  it("only includes binding instructions when the gate is enabled", () => {
    const disabled = generateSystemPrompt({ library: librarySpec as LibrarySpec, promptOptions: createCotGenUIPromptOptions({ localBindings: false, examples: [] }) });
    const enabled = generateSystemPrompt({ library: librarySpec as LibrarySpec, promptOptions: createCotGenUIPromptOptions({ localBindings: true, examples: [] }) });
    expect(disabled).not.toContain("Declare mutable state");
    expect(enabled).toContain("Declare mutable state");
    expect(enabled).toContain("Local bindings are only for transient in-card UI state");
  });
});
