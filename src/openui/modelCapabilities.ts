import type { ModelProfile } from "@/lib/pipelineTypes";

export type OpenUIPromptTier = "compact" | "expanded";

export const OPENUI_PROMPT_TIER: Record<ModelProfile, OpenUIPromptTier> = {
  groq_qwen_3_6_27b: "compact",
  hf_community_qwen_3_8_27b: "compact",
  nvidia_diffusion_gemma_26b: "compact",
  glm_4_7_flash: "compact",
  groq_gpt_oss_120b: "expanded",
  glm_5_2: "expanded",
  glm_5_2_thinking: "expanded",
};

export function openUIPromptTierFor(modelProfile: ModelProfile): OpenUIPromptTier {
  return OPENUI_PROMPT_TIER[modelProfile];
}
