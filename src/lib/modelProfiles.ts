import "server-only";

import type { LLMProvider } from "@/lib/llm";
import { NVIDIA_DIFFUSION_GEMMA_MODEL } from "@/lib/nvidia";
import type { ModelProfile } from "@/lib/pipelineTypes";

export type GroqReasoningEffort = "none" | "default" | "low" | "medium" | "high";

export interface ResolvedModelProfile {
  model: string;
  thinking: boolean;
  provider: LLMProvider;
  groqReasoningEffort?: GroqReasoningEffort;
  includeReasoning?: boolean;
}

export function resolveModelProfile(profile: ModelProfile): ResolvedModelProfile {
  switch (profile) {
    case "groq_qwen_3_6_27b":
      return { model: "qwen/qwen3.6-27b", thinking: false, provider: "groq", groqReasoningEffort: "none" };
    case "groq_gpt_oss_120b":
      return { model: "openai/gpt-oss-120b", thinking: true, provider: "groq", groqReasoningEffort: "medium", includeReasoning: false };
    case "hf_community_qwen_3_8_27b":
      return { model: "Qwen/Qwen3.8-27B", thinking: false, provider: "hf_community" };
    case "nvidia_diffusion_gemma_26b":
      return { model: NVIDIA_DIFFUSION_GEMMA_MODEL, thinking: false, provider: "nvidia" };
    case "glm_5_2_thinking":
      return { model: "glm-5.2", thinking: true, provider: "glm" };
    case "glm_5_2":
      return { model: "glm-5.2", thinking: false, provider: "glm" };
    case "glm_4_7_flash":
      return { model: "glm-4.7-flash", thinking: false, provider: "glm" };
  }
}

export function canCallModelProfile(profile: ModelProfile): boolean {
  if (profile === "hf_community_qwen_3_8_27b") return true;
  if (profile === "nvidia_diffusion_gemma_26b") return !!process.env.NVIDIA_API_KEY;
  if (profile.startsWith("groq_")) return !!process.env.GROQ_API_KEY;
  return !!process.env.LLM_API_KEY;
}

