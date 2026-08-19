import type { CardPlan } from "@/dsl/modules";
import type { InferConflict, InferQuestion, InferResult, InferSlot } from "@/lib/schemas";
import type { ProfileDigest, RetrievalRequest } from "@/lib/profileTypes";

export const PIPELINE_STEPS = [
  "intent_analysis",
  "evidence_resolution",
  "clarification",
  "context_enrichment",
  "card_plan_generate",
  "openui_generate",
] as const;

export type PipelineStepName = (typeof PIPELINE_STEPS)[number];

export const MODEL_PROFILES = ["groq_qwen_3_6_27b", "groq_gpt_oss_120b", "hf_community_qwen_3_8_27b", "nvidia_diffusion_gemma_26b", "glm_5_2_thinking", "glm_5_2", "glm_4_7_flash"] as const;
export type ModelProfile = (typeof MODEL_PROFILES)[number];

export const MODEL_PROFILE_LABELS: Record<ModelProfile, string> = {
  groq_qwen_3_6_27b: "Groq · Qwen3.6-27B",
  groq_gpt_oss_120b: "Groq · GPT-OSS-120B",
  hf_community_qwen_3_8_27b: "HF Community · Qwen3.8-27B",
  nvidia_diffusion_gemma_26b: "NVIDIA · DiffusionGemma-26B",
  glm_5_2_thinking: "glm-5.2 · Thinking",
  glm_5_2: "glm-5.2",
  glm_4_7_flash: "glm-4.7-flash",
};

export interface SlotRequirement {
  name: string;
  description: string;
  required: boolean;
  label?: string;
  weight?: number;
  blocking?: boolean;
  /** 需要用户确认时使用的 2-4 个互斥候选答案 */
  options?: string[];
  explicitValue?: string;
}

export interface InferenceState {
  taskType: string;
  fulfillment?: {
    outcome: "ideas" | "verified_recommendations" | "actionable";
    requiresFreshData: boolean;
    requiresLocation: boolean;
    requiresActionLink: boolean;
  };
  needsContext: boolean;
  requestedDomains?: string[];
  retrievalRequests?: RetrievalRequest[];
  profileDigest?: ProfileDigest;
  slotRequirements: SlotRequirement[];
  slots: InferSlot[];
  conflicts: InferConflict[];
  questions: InferQuestion[];
  assumptions: string[];
  summary?: string;
  webFacts?: Array<{
    query: string;
    summary: string;
    sources?: string[];
    entities?: Array<{
      name: string;
      category?: string;
      description: string;
      locality?: string;
      sourceUrl: string;
      actionUrl?: string;
      actionKind: "order" | "reserve" | "details";
    }>;
  }>;
  capabilityCalls?: Array<{ capability: string; query: string; status: "success" | "skipped" | "error" }>;
  /** ④ 从 provider 原始 web_search 结果提取的 URL（不可被模型伪造），供 ⑤ 构建 allowlist */
  providerSearchUrls?: string[];
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  cached: number;
}

export interface StepTiming {
  /** 从 API Route 收到请求到完成序列化前的端到端耗时 */
  totalMs: number;
  /** 本步骤所有模型请求的墙钟耗时之和 */
  llmMs: number;
  /** 应用侧编排、校验和派生处理耗时 */
  overheadMs: number;
  /** 模型响应的 created 时间戳；它不是推理耗时 */
  providerCreatedAt?: number;
  /** provider 未报告纯推理分段时延，当前仍保留给后续可观测性扩展 */
  timeToFirstReasoningMs?: number;
  /** 从模型请求发出到首个非空正文 delta 的墙钟耗时 */
  timeToFirstContentMs?: number;
  /** 从模型请求发出到首条完整 OpenUI 顶层 statement 的墙钟耗时 */
  timeToFirstModelStatementMs?: number;
}

export interface PipelineStepOutput {
  name: PipelineStepName;
  reasoning: string;
  outputs: Record<string, unknown>;
  inferenceState?: InferenceState;
  slots?: InferSlot[];
  conflicts?: InferConflict[];
  questions?: InferQuestion[];
  result?: InferResult;
  cardPlan?: CardPlan;
  cardPlanMarkdown?: string;
  reasoningGraph?: string;
  /** 第⑥步模型直接生成、通过 OpenUI parser 校验的 OpenUI Lang 源码 */
  openuiCode?: string;
  openuiDiagnostics?: {
    coverage: { required: number; matched: number; missing: string[] };
    parser: { statements: number; unresolved: string[]; orphaned: string[]; incomplete: boolean };
    repaired: boolean;
    repairTriggered: boolean;
    repairMs?: number;
  };
  durationMs: number;
  timing: StepTiming;
  model: string;
  modelProfile?: ModelProfile;
  usage?: TokenUsage;
  cost?: number;
}
