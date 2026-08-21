import { describe, expect, it } from "vitest";
import { ALL_OPENUI_EXAMPLES, createCotGenUIPromptOptions } from "../../src/openui/promptOptions";
import { openUISystemPromptFor } from "../../src/openui/promptRouting";

describe("non-renderable design metadata guidance", () => {
  it("marks designIntent as NON-RENDERABLE in the system prompt", () => {
    const options = createCotGenUIPromptOptions({ localBindings: false, examples: [] });
    const prompt = options.preamble + "\n" + (options.additionalRules ?? []).join("\n");

    expect(prompt).toContain("NON-RENDERABLE");
    expect(prompt).toContain("renderableContent is the only textual source that may be copied or paraphrased into visible UI");
  });

  it("keeps the URL/tool prohibition rules", () => {
    const options = createCotGenUIPromptOptions({ localBindings: false, examples: [] });
    const prompt = (options.additionalRules ?? []).join("\n");

    expect(prompt).toContain("Never use Query, Mutation, @Run, @OpenUrl");
    expect(prompt).toContain("never place an image URL in OpenUI source");
    expect(prompt).toContain("requiredShell is the sole source of truth");
  });

  it("does not reference cardPlanMarkdown as the generation protocol anymore", () => {
    const options = createCotGenUIPromptOptions({ localBindings: false, examples: [] });
    const prompt = options.preamble + "\n" + (options.additionalRules ?? []).join("\n");

    expect(prompt).not.toContain("cardPlanMarkdown");
    expect(prompt).not.toContain("CardPlan Markdown");
  });

  it("examples never render design enums, Card IDs, or authoring guidance as visible text", () => {
    for (const example of ALL_OPENUI_EXAMPLES) {
      // 可见文本只出现在字符串字面量里；检查常见泄漏形式
      expect(example).not.toMatch(/TextContent\("[^"]*(archetype|density|emphasis)[^"]*"/i);
      expect(example).not.toMatch(/TextContent\("[^"]*Card ID[^"]*"/i);
      expect(example).not.toContain("整体创作方向");
      expect(example).not.toContain("感觉与节奏");
      expect(example).not.toContain("Vibe brief");
    }
  });

  it("routes the design-brief semantics through task-family prompts for both palettes", () => {
    const compact = openUISystemPromptFor({ taskFamily: "planning", modelProfile: "groq_qwen_3_6_27b" });
    expect(compact.promptProfile).toContain("compact");
    expect(compact.prompt).toContain("designIntent");
    expect(compact.prompt).toContain("NON-RENDERABLE");

    const expanded = openUISystemPromptFor({ taskFamily: "planning", modelProfile: "glm_5_2" });
    expect(expanded.promptProfile).toContain("expanded");
    expect(expanded.prompt).toContain("designIntent");
    expect(expanded.prompt).toContain("NON-RENDERABLE");
  });
});
