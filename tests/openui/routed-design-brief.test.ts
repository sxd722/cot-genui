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

  it("keeps safe image adoption guidance in every routed prompt", () => {
    for (const taskFamily of ["general", "planning", "recommendation", "analysis"] as const) {
      const routed = openUISystemPromptFor({ taskFamily, modelProfile: "groq_qwen_3_6_27b" });
      expect(routed.prompt).toContain("Every distinct requestId with non-empty availableAssets is a required CardPlan image requirement");
      expect(routed.prompt).toContain("omission of an accepted request is invalid and will trigger one repair");
      expect(routed.prompt).toContain("role=hero");
      expect(routed.prompt).toContain("role=supporting");
      expect(routed.prompt).toContain("role=gallery");
      expect(routed.prompt).toContain("Never invent an asset ID");
    }
  });

  it("does not expose URLs or enable OpenUI tools in routed prompts", () => {
    const routed = openUISystemPromptFor({ taskFamily: "recommendation", modelProfile: "groq_qwen_3_6_27b" });

    expect(routed.prompt).not.toMatch(/https?:\/\//);
    expect(routed.prompt).toContain("Never use Query, Mutation, @Run, @OpenUrl");
    expect(createCotGenUIPromptOptions({ localBindings: false, examples: [] }).toolCalls).toBe(false);
  });
});
