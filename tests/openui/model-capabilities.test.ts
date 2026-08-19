import { describe, expect, it } from "vitest";
import { openUIPromptTierFor } from "../../src/openui/modelCapabilities";

describe("OpenUI model capability tiers", () => {
  it("routes 26-30B and Flash profiles to compact prompts", () => {
    expect(openUIPromptTierFor("groq_qwen_3_6_27b")).toBe("compact");
    expect(openUIPromptTierFor("hf_community_qwen_3_8_27b")).toBe("compact");
    expect(openUIPromptTierFor("nvidia_diffusion_gemma_26b")).toBe("compact");
    expect(openUIPromptTierFor("glm_4_7_flash")).toBe("compact");
  });

  it("keeps larger reasoning profiles expanded", () => {
    expect(openUIPromptTierFor("glm_5_2")).toBe("expanded");
    expect(openUIPromptTierFor("groq_gpt_oss_120b")).toBe("expanded");
  });
});
