import { describe, expect, it } from "vitest";
import { createCotGenUIPromptOptions } from "../../src/openui/promptOptions";
import { openUISystemPromptFor } from "../../src/openui/promptRouting";

describe("routed OpenUI design-brief capability", () => {
  it("keeps planning requests on the compact palette for 27B and Flash models", () => {
    for (const modelProfile of ["groq_qwen_3_6_27b", "hf_community_qwen_3_8_27b", "glm_4_7_flash"] as const) {
      const routed = openUISystemPromptFor({ taskFamily: "planning", modelProfile });

      expect(routed.promptProfile).toBe("compact:planning");
      expect(routed.prompt).toContain("AssetImage");
      expect(routed.prompt).toContain("AssetGallery");
      expect(routed.prompt).toContain("MediaHero");
      expect(routed.prompt).toContain("designIntent");
      expect(routed.prompt).toContain("NON-RENDERABLE");
      expect(routed.prompt).not.toContain("CardPlan Markdown");
    }
  });

  it("keeps GLM-5.2 on the expanded palette", () => {
    const routed = openUISystemPromptFor({ taskFamily: "planning", modelProfile: "glm_5_2" });

    expect(routed.promptProfile).toBe("expanded:general");
    expect(routed.prompt).toContain("AssetImage");
    expect(routed.prompt).toContain("designIntent");
    expect(routed.prompt).toContain("NON-RENDERABLE");
  });

  it("does not expose URLs or enable OpenUI tools in routed prompts", () => {
    const routed = openUISystemPromptFor({ taskFamily: "recommendation", modelProfile: "groq_qwen_3_6_27b" });

    expect(routed.prompt).not.toMatch(/https?:\/\//);
    expect(routed.prompt).toContain("Never use Query, Mutation, @Run, @OpenUrl");
    expect(createCotGenUIPromptOptions({ localBindings: false, examples: [] }).toolCalls).toBe(false);
  });
});
