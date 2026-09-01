import "server-only";

import OpenAI from "openai";
import { createLLMClient, extractJson, hasAnyLLMKey, type CallLog, type LLMProvider } from "@/lib/llm";
import type { CardLayoutMode, CardPlan } from "@/dsl/modules";
import type { InferConflict, InferQuestion, InferSlot } from "@/lib/schemas";
import {
  mockOpenUIFromCardPlan,
  normalizeOpenUIOutput,
  openUISystemPromptFor,
  validateOpenUIArtifact,
} from "@/lib/openui";
import { buildOpenUIGenerationPayload, buildOpenUIRepairPayload } from "@/openui/payload";
import { hasCompleteOpenUIStatement } from "@/openui/streamTiming";
import { cardPlanToVibeMarkdown } from "@/openui/vibeMarkdown";
import { conciseCardTitle } from "@/openui/cardTitle";
import { retrieveProfileEvidence } from "@/lib/profile";
import type { ProfileDigest } from "@/lib/profileTypes";
import { cardPlanSystemPromptFor } from "@/lib/cardPlanPrompt";
import { normalizeCardPlanEnvelope } from "@/lib/cardPlanResponse";
import { sanitizeCardPlanExternalLinks } from "@/lib/webFactIntegration";
import { NVIDIA_DIFFUSION_GEMMA_MODEL, nvidiaChatOptions } from "@/lib/nvidia";
import { resolveModelProfile, type GroqReasoningEffort } from "@/lib/modelProfiles";
import { classifyQuery } from "@/lib/adaptive/classification";
import type { EffectiveAdaptiveContext, QueryClassification } from "@/lib/adaptive/types";
import { buildProfileView } from "@/lib/profileView";
import { summarizeStepForProvenance } from "@/lib/provenance";
import type { ProfileViewV2, RetrievedEvidence } from "@/lib/profileTypes";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { analyzeOpenUIQuality } from "@/openui/qualityMetrics";
import { normalizeAssetRequest, normalizeCardPresentation, normalizeCardSequence } from "@/lib/cardPlanNormalize";
import { disabledAssetResolution, resolveAssetManifest } from "@/openui/assetResolver";
import type { AssetResolutionDiagnostics } from "@/openui/assetTypes";
import { ensureAssetRequests, type MediaPlanningDiagnostics } from "@/openui/mediaPlanning";
import type { SkillStepContext } from "@/learning/workflowTypes";
import { describeSkillReuseEffect, deterministicClarification, deterministicEnrichment, deterministicIntent, skillPriorText } from "@/lib/skillReuse";
import { cardLayoutPolicy, estimateCardLayout, fitCardPlanToLayout, fixedOpenUILayoutPrompt, normalizeCardLayoutMode, withCardLayoutPolicy } from "@/openui/layoutPolicy";
import {
  PIPELINE_STEPS,
  type InferenceState,
  type ModelProfile,
  type PipelineStepName,
  type PipelineStepOutput,
  type TokenUsage,
} from "@/lib/pipelineTypes";

export { PIPELINE_STEPS };
export type { PipelineStepName, PipelineStepOutput };

interface RunInput {
  name: PipelineStepName;
  query: string;
  deviceContext: Record<string, unknown>;
  inferenceState?: InferenceState;
  userAnswers?: Record<number, string>;
  cardPlan?: CardPlan;
  layoutMode?: CardLayoutMode;
  mediaPlanningDiagnostics?: Pick<MediaPlanningDiagnostics, "modelDeclared" | "synthesized">;
  profileDigest?: ProfileDigest;
  profileSourceText?: string;
  classification?: QueryClassification;
  adaptiveContext?: EffectiveAdaptiveContext;
  skillContext?: SkillStepContext;
  modelProfile?: ModelProfile;
  /** 暂停期预取的搜索结果：searchQuery 与 ④ 最终计算一致时注入，跳过 tool 调用 */
  prefetchedSearch?: { searchQuery: string; webSearchRaw: unknown };
  stream?: boolean;
  onStreamDelta?: (delta: string, cumulativeChars: number) => void;
  mock?: boolean;
  onLog?: (entry: CallLog) => void;
}

interface LLMResult {
  value: unknown;
  model: string;
  llmMs: number;
  usage?: TokenUsage;
  providerCreatedAt?: number;
  timeToFirstContentMs?: number;
  timeToFirstModelStatementMs?: number;
  cost?: number;
  webSearch?: unknown;
}

const DEFAULT_PROFILES: Record<PipelineStepName, ModelProfile> = {
  intent_analysis: "groq_qwen_3_6_27b",
  evidence_resolution: "groq_qwen_3_6_27b",
  clarification: "groq_qwen_3_6_27b",
  context_enrichment: "groq_qwen_3_6_27b",
  card_plan_generate: "groq_qwen_3_6_27b",
  openui_generate: "groq_qwen_3_6_27b",
};

const STEP_SAMPLING: Record<PipelineStepName, { temperature: number; doSample: boolean }> = {
  // 槽位定义需要覆盖用户没有明说、但会显著影响结果的维度，允许较强发散。
  intent_analysis: { temperature: 0.8, doSample: true },
  // 证据解析允许少量候选解释，但仍以引用事实和稳定置信度为主。
  evidence_resolution: { temperature: 0.35, doSample: true },
  clarification: { temperature: 0.25, doSample: true },
  context_enrichment: { temperature: 0.2, doSample: true },
  // 允许 Step 5 真正选择信息拓扑，同时保持较低随机性。
  card_plan_generate: { temperature: 0.3, doSample: true },
  // OpenUI 需要适度视觉变化，同时优先保证语法稳定与低时延。
  openui_generate: { temperature: 0.2, doSample: true },
};

const CARD_PLAN_SCHEMA_HINT = "{reasoning:string,cardPlan:{skillName:string,iconText?:string,reasoning:string,cards:[{id:string,title:string,purpose:string,sourceSlots?:string[],presentation?:{archetype:'standard'|'hero'|'editorial'|'comparison'|'timeline'|'data'|'action'|'media',density?:'compact'|'balanced'|'immersive',emphasis?:'content'|'data'|'media'|'action'},blocks:[{kind:'hero'|'summary'|'list'|'progress'|'status'|'metric'|'choice'|'toggle'|'image'|'chart'|'infographic',title?:string,text?:string,detail?:string,tone?:string,value?:string,valueFromSlot?:string,items?:[{label:string,detail?:string}],itemsFromSlot?:string,options?:string[],currentFromSlot?:string,metrics?:[{label:string,value:string,unit?:string}],sourceSlots?:string[],assetRequest?:{kind:'image'|'gallery',query:string,count:number,role:'hero'|'supporting'|'gallery',aspect?:'wide'|'square'|'portrait'}}],actions?:[{id:string,label:string,type:'navigate'|'select'|'toggle'|'external-link'|'confirm'|'copy'|'save'|'pick-file'|'ocr'|'llm-call',targetCardId?:string,writeTo?:string,writeValue?:string,link?:string,role?:'primary'|'secondary'|'tertiary'}]}]}}";

function log(onLog: RunInput["onLog"], phase: CallLog["phase"], message: string, detail?: unknown) {
  onLog?.({ ts: new Date().toISOString(), phase, message, detail });
}

function normalizeUsage(usage: OpenAI.CompletionUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const details = usage.prompt_tokens_details as { cached_tokens?: number } | undefined;
  return {
    prompt: usage.prompt_tokens ?? 0,
    completion: usage.completion_tokens ?? 0,
    total: usage.total_tokens ?? 0,
    cached: details?.cached_tokens ?? 0,
  };
}

function estimateCost(model: string, usage?: TokenUsage): number | undefined {
  if (!usage) return undefined;
  const configured = process.env.LLM_PRICING_JSON;
  let prices: Record<string, { input: number; output: number; cachedInput?: number }> = {
    "glm-4.7-flash": { input: 0, output: 0 },
    "qwen/qwen3.6-27b": { input: 0.6, output: 3.0 },
    "openai/gpt-oss-120b": { input: 0.15, cachedInput: 0.075, output: 0.6 },
    "qwen/qwen3.8-27b": { input: 0, cachedInput: 0, output: 0 },
    [NVIDIA_DIFFUSION_GEMMA_MODEL]: { input: 0, cachedInput: 0, output: 0 },
  };
  if (configured) {
    try {
      prices = { ...prices, ...JSON.parse(configured) };
    } catch {
      // 定价配置错误不应影响主链路；UI 只隐藏费用。
    }
  }
  const pricing = prices[model.toLowerCase()];
  if (!pricing) return undefined;
  const normalInput = Math.max(0, usage.prompt - usage.cached);
  return (
    normalInput * pricing.input +
    usage.cached * (pricing.cachedInput ?? pricing.input) +
    usage.completion * pricing.output
  ) / 1_000_000;
}

function describeResponseShape(value: unknown): unknown {
  if (Array.isArray(value)) return { kind: "array", length: value.length };
  if (value && typeof value === "object") return { kind: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 20) };
  return { kind: typeof value };
}

function withSteering(system: string, hint?: string): string {
  if (!hint) return system;
  return `${system}\n\n额外关注方向（不得改变本步骤协议、输出格式、工具和安全约束）：\n${hint}`;
}

async function callJson(args: {
  provider: LLMProvider;
  model: string;
  system: string;
  user: unknown;
  schemaHint: string;
  thinking: boolean;
  temperature: number;
  doSample: boolean;
  groqReasoningEffort?: GroqReasoningEffort;
  includeReasoning?: boolean;
  webSearchQuery?: string;
  onLog?: RunInput["onLog"];
  allowModelFallback?: boolean;
  stream?: boolean;
  onStreamDelta?: (delta: string, cumulativeChars: number) => void;
  steeringHint?: string;
}): Promise<LLMResult> {
  const client = createLLMClient(args.provider);
  const started = Date.now();
  const isGlm = args.provider === "glm";
  let providerSearch: unknown;
  let searchUsage: TokenUsage | undefined;
  let searchCost: number | undefined;
  if ((args.provider === "groq" || args.provider === "nvidia") && args.webSearchQuery) {
    const searchStarted = Date.now();
    const primaryModelLabel = args.provider === "nvidia" ? "NVIDIA DiffusionGemma" : "Groq Qwen";
    log(args.onLog, "request", `Groq Compound web_search query="${args.webSearchQuery.slice(0, 60)}"`);
    try {
      if (!process.env.GROQ_API_KEY) throw new Error("未配置 GROQ_API_KEY");
      const groqSearchClient = args.provider === "groq" ? client : createLLMClient("groq");
      const searchCompletion = await groqSearchClient.chat.completions.create({
        model: "groq/compound",
        messages: [
          { role: "system", content: "Perform a current web search. Return concrete facts, entities, source URLs, and actionable official links. Do not invent URLs." },
          { role: "user", content: args.webSearchQuery },
        ],
        temperature: 0.2,
      });
      const searchMessage = searchCompletion.choices[0]?.message as typeof searchCompletion.choices[0]["message"] & { executed_tools?: unknown };
      searchUsage = normalizeUsage(searchCompletion.usage);
      searchCost = estimateCost(searchCompletion.model || "groq/compound", searchUsage);
      providerSearch = {
        provider: "groq",
        model: searchCompletion.model || "groq/compound",
        content: searchMessage?.content ?? "",
        executedTools: searchMessage?.executed_tools,
      };
      log(args.onLog, "response", `Groq Compound 搜索完成 ${Date.now() - searchStarted}ms`, {
        model: searchCompletion.model,
        usage: searchCompletion.usage,
        executedTools: searchMessage?.executed_tools,
      });
    } catch (compoundError) {
      log(args.onLog, "fallback", `Groq Compound 不可用，尝试使用 GLM 仅执行联网检索；主推理仍由 ${primaryModelLabel} 完成`, {
        error: compoundError instanceof Error ? compoundError.message : String(compoundError),
      });
      if (process.env.LLM_API_KEY) {
        const glmSearchStarted = Date.now();
        try {
          const glmClient = createLLMClient("glm");
          const glmSearchCompletion = await glmClient.chat.completions.create({
            model: "glm-5.2",
            messages: [
              {
                role: "system",
                content: "你只负责执行一次当前信息联网检索。返回具体事实、实体、来源 URL 和可操作的官方链接；禁止编造 URL。只返回合法 JSON。",
              },
              { role: "user", content: args.webSearchQuery },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
            thinking: { type: "disabled" },
            do_sample: true,
            tools: [{
              type: "web_search",
              web_search: {
                enable: true,
                search_query: args.webSearchQuery,
                search_result: true,
                count: 5,
                content_size: "medium",
              },
            }],
            tool_choice: "auto",
          } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming & {
            thinking: { type: "disabled" };
            do_sample: boolean;
          });
          const glmSearchUsage = normalizeUsage(glmSearchCompletion.usage);
          searchUsage = addUsage(searchUsage, glmSearchUsage);
          searchCost = (searchCost ?? 0) + (estimateCost(glmSearchCompletion.model || "glm-5.2", glmSearchUsage) ?? 0);
          providerSearch = {
            provider: "glm",
            model: glmSearchCompletion.model || "glm-5.2",
            content: glmSearchCompletion.choices[0]?.message?.content ?? "",
            raw: (glmSearchCompletion as unknown as { web_search?: unknown }).web_search,
          };
          log(args.onLog, "response", `GLM 联网检索降级完成 ${Date.now() - glmSearchStarted}ms；继续交给 ${primaryModelLabel} 归纳`, {
            model: glmSearchCompletion.model,
            usage: glmSearchCompletion.usage,
          });
        } catch (glmSearchError) {
          log(args.onLog, "fallback", `联网检索能力当前均不可用；跳过新鲜信息检索并继续 ${primaryModelLabel} 主流程`, {
            error: glmSearchError instanceof Error ? glmSearchError.message : String(glmSearchError),
          });
        }
      } else {
        log(args.onLog, "fallback", `未配置 GLM 搜索备用能力；跳过新鲜信息检索并继续 ${primaryModelLabel} 主流程`);
      }
    }
  }
  const effectiveUser = providerSearch
    ? { request: args.user, providerSearchResults: providerSearch }
    : args.user;
  const searchMode = !args.webSearchQuery
    ? ""
    : args.provider === "groq" || args.provider === "nvidia"
      ? providerSearch ? " search=provider-injected" : " search=unavailable"
      : args.provider === "glm"
        ? " tool=web_search"
        : " search=unsupported";
  log(args.onLog, "request", `POST /chat/completions provider=${args.provider} model=${args.model} thinking=${args.thinking ? "enabled" : "disabled"} temperature=${args.temperature} do_sample=${args.doSample}${searchMode}${args.stream ? " stream=true" : ""}`);

  const params = {
    model: args.model,
    messages: [
      { role: "system" as const, content: `${withSteering(args.system, args.steeringHint)}\n只返回合法 JSON。输出结构：${args.schemaHint}` },
      { role: "user" as const, content: JSON.stringify(effectiveUser) },
    ],
    // NVIDIA/vLLM rejects json_object unless a full JSON Schema is supplied.
    // These pipeline prompts currently expose a semantic schemaHint, so keep
    // NVIDIA unconstrained here and rely on the JSON-only prompt + extractor.
    ...(args.provider !== "nvidia"
      ? { response_format: { type: "json_object" as const } }
      : {}),
    temperature: args.temperature,
    ...(isGlm
      ? {
          thinking: { type: args.thinking ? "enabled" : "disabled" },
          do_sample: args.doSample,
          ...(args.thinking ? { reasoning_effort: "high" } : {}),
        }
      : {}),
    ...(args.provider === "groq"
      ? {
          reasoning_effort: args.groqReasoningEffort ?? (args.thinking ? "default" : "none"),
          ...(args.includeReasoning !== undefined ? { include_reasoning: args.includeReasoning } : {}),
        }
      : {}),
    ...(args.provider === "nvidia" ? nvidiaChatOptions(args.thinking) : {}),
    ...(isGlm && args.webSearchQuery
      ? {
          tools: [{
            type: "web_search",
            web_search: {
              enable: true,
              search_query: args.webSearchQuery,
              search_result: true,
              count: 5,
              content_size: "medium",
            },
          }],
          tool_choice: "auto",
        }
      : {}),
  } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming & {
    thinking?: { type: "enabled" | "disabled" };
    do_sample?: boolean;
    reasoning_effort?: string;
    include_reasoning?: boolean;
    chat_template_kwargs?: { enable_thinking: boolean };
  };

  if (args.stream && !args.webSearchQuery) {
    try {
      const completionStream = await client.chat.completions.create({
        ...params,
        stream: true,
        stream_options: { include_usage: true },
      } as unknown as OpenAI.ChatCompletionCreateParamsStreaming);
      let content = "";
      let responseModel = args.model;
      let providerCreatedAt: number | undefined;
      let rawUsage: OpenAI.CompletionUsage | undefined;
      let finishReason: string | null | undefined;
      for await (const rawChunk of completionStream) {
        const chunk = rawChunk as typeof rawChunk & { usage?: OpenAI.CompletionUsage | null };
        const delta = chunk.choices[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          content += delta;
          args.onStreamDelta?.(delta, content.length);
        }
        if (chunk.model) responseModel = chunk.model;
        if (chunk.created) providerCreatedAt = chunk.created;
        if (chunk.usage) rawUsage = chunk.usage;
        if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      }
      const llmMs = Date.now() - started;
      const usage = addUsage(searchUsage, normalizeUsage(rawUsage));
      let value: unknown;
      try {
        value = extractJson(content);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log(args.onLog, "error", `模型 JSON 解析失败 [json_parse] · ${reason}`, {
          stage: "json_parse",
          reason,
          provider: args.provider,
          model: responseModel,
          finishReason,
          responseChars: content.length,
          streamed: true,
        });
        throw error;
      }
      log(args.onLog, "response", `模型流式响应完成 ${llmMs}ms`, {
        model: responseModel,
        created: providerCreatedAt,
        usage: rawUsage,
        llmMs,
        streamedChars: content.length,
        finishReason,
        responseShape: describeResponseShape(value),
        note: "created 是响应时间戳，不是服务端推理耗时",
      });
      return {
        value,
        model: responseModel,
        llmMs,
        usage,
        providerCreatedAt,
        cost: (searchCost ?? 0) + (estimateCost(responseModel, normalizeUsage(rawUsage)) ?? 0),
        webSearch: providerSearch,
      };
    } catch (error) {
      const failedStreamMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      if (args.provider === "hf_community") {
        log(args.onLog, "error", `HF Community 流式请求失败 ${failedStreamMs}ms: ${message}`);
        throw new Error(`HF Community Endpoint 不可用、拥塞或已下线：${message}`, { cause: error });
      }
      log(args.onLog, "fallback", `流式请求失败 ${failedStreamMs}ms，自动回退非流式: ${error instanceof Error ? error.message : String(error)}`);
      const fallback = await callJson({ ...args, stream: false, onStreamDelta: undefined });
      return { ...fallback, llmMs: failedStreamMs + fallback.llmMs };
    }
  }

  try {
    const completion = await client.chat.completions.create(params);
    const llmMs = Date.now() - started;
    const primaryUsage = normalizeUsage(completion.usage);
    const usage = addUsage(searchUsage, primaryUsage);
    const content = completion.choices[0]?.message?.content ?? "";
    const finishReason = completion.choices[0]?.finish_reason;
    let value: unknown;
    try {
      value = extractJson(content);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(args.onLog, "error", `模型 JSON 解析失败 [json_parse] · ${reason}`, {
        stage: "json_parse",
        reason,
        provider: args.provider,
        model: completion.model || args.model,
        finishReason,
        responseChars: content.length,
        streamed: false,
      });
      throw error;
    }
    log(args.onLog, "response", `模型响应完成 ${llmMs}ms`, {
      model: completion.model,
      created: completion.created,
      usage: completion.usage,
      llmMs,
      finishReason,
      responseShape: describeResponseShape(value),
      webSearch: (completion as unknown as { web_search?: unknown }).web_search,
      note: "created 是响应时间戳，不是服务端推理耗时",
    });
    return {
      value,
      model: completion.model || args.model,
      llmMs,
      usage,
      providerCreatedAt: completion.created,
      cost: (searchCost ?? 0) + (estimateCost(completion.model || args.model, primaryUsage) ?? 0),
      webSearch: providerSearch ?? (completion as unknown as { web_search?: unknown }).web_search,
    };
  } catch (error) {
    const llmMs = Date.now() - started;
    log(args.onLog, "error", `模型请求失败 ${llmMs}ms: ${error instanceof Error ? error.message : String(error)}`);
    const message = error instanceof Error ? error.message : String(error);
    if (args.model === "glm-4.7-flash" && args.allowModelFallback !== false && /429|访问量过大|rate.?limit/i.test(message)) {
      log(args.onLog, "fallback", "glm-4.7-flash 服务繁忙，自动改用 glm-5.2（thinking disabled）重试一次");
      return callJson({ ...args, provider: "glm", model: "glm-5.2", thinking: false, allowModelFallback: false });
    }
    if (args.provider === "hf_community") {
      throw new Error(`HF Community Endpoint 不可用、拥塞或已下线：${message}`, { cause: error });
    }
    if (args.provider === "nvidia") {
      throw new Error(`NVIDIA Build DiffusionGemma 请求失败：${message}`, { cause: error });
    }
    throw error;
  }
}

async function callText(args: {
  provider: LLMProvider;
  model: string;
  system: string;
  user: unknown;
  thinking: boolean;
  temperature: number;
  doSample: boolean;
  groqReasoningEffort?: GroqReasoningEffort;
  includeReasoning?: boolean;
  onLog?: RunInput["onLog"];
  allowModelFallback?: boolean;
  stream?: boolean;
  onStreamDelta?: RunInput["onStreamDelta"];
  steeringHint?: string;
}): Promise<LLMResult> {
  const client = createLLMClient(args.provider);
  const started = Date.now();
  const isGlm = args.provider === "glm";
  log(args.onLog, "request", `POST /chat/completions provider=${args.provider} model=${args.model} thinking=${args.thinking ? "enabled" : "disabled"} temperature=${args.temperature} do_sample=${args.doSample}${args.stream ? " stream=true format=openui-lang" : " format=openui-lang"}`);
  const params = {
    model: args.model,
    messages: [
      { role: "system" as const, content: withSteering(args.system, args.steeringHint) },
      { role: "user" as const, content: JSON.stringify(args.user) },
    ],
    temperature: args.temperature,
    ...(isGlm
      ? {
          thinking: { type: args.thinking ? "enabled" : "disabled" },
          do_sample: args.doSample,
          ...(args.thinking ? { reasoning_effort: "high" } : {}),
        }
      : {}),
    ...(args.provider === "groq"
      ? {
          reasoning_effort: args.groqReasoningEffort ?? (args.thinking ? "default" : "none"),
          ...(args.includeReasoning !== undefined ? { include_reasoning: args.includeReasoning } : {}),
        }
      : {}),
    ...(args.provider === "nvidia" ? nvidiaChatOptions(args.thinking) : {}),
  } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming & {
    thinking?: { type: "enabled" | "disabled" };
    do_sample?: boolean;
    reasoning_effort?: string;
    include_reasoning?: boolean;
    chat_template_kwargs?: { enable_thinking: boolean };
  };

  try {
    if (args.stream) {
      const completionStream = await client.chat.completions.create({
        ...params,
        stream: true,
        stream_options: { include_usage: true },
      } as unknown as OpenAI.ChatCompletionCreateParamsStreaming);
      let content = "";
      let responseModel = args.model;
      let providerCreatedAt: number | undefined;
      let rawUsage: OpenAI.CompletionUsage | undefined;
      let timeToFirstContentMs: number | undefined;
      let timeToFirstModelStatementMs: number | undefined;
      for await (const rawChunk of completionStream) {
        const chunk = rawChunk as typeof rawChunk & { usage?: OpenAI.CompletionUsage | null };
        const delta = chunk.choices[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          content += delta;
          const elapsedMs = Date.now() - started;
          if (timeToFirstContentMs === undefined && delta.trim().length > 0) {
            timeToFirstContentMs = elapsedMs;
          }
          if (timeToFirstModelStatementMs === undefined && hasCompleteOpenUIStatement(content)) {
            timeToFirstModelStatementMs = elapsedMs;
          }
          args.onStreamDelta?.(delta, content.length);
        }
        if (chunk.model) responseModel = chunk.model;
        if (chunk.created) providerCreatedAt = chunk.created;
        if (chunk.usage) rawUsage = chunk.usage;
      }
      const llmMs = Date.now() - started;
      if (timeToFirstModelStatementMs === undefined && hasCompleteOpenUIStatement(content, true)) {
        timeToFirstModelStatementMs = llmMs;
      }
      const usage = normalizeUsage(rawUsage);
      log(args.onLog, "response", `模型流式 OpenUI 响应完成 ${llmMs}ms`, {
        model: responseModel,
        created: providerCreatedAt,
        usage: rawUsage,
        llmMs,
        streamedChars: content.length,
        timeToFirstContentMs,
        timeToFirstModelStatementMs,
      });
      return {
        value: content,
        model: responseModel,
        llmMs,
        usage,
        providerCreatedAt,
        timeToFirstContentMs,
        timeToFirstModelStatementMs,
        cost: estimateCost(responseModel, usage),
      };
    }

    const completion = await client.chat.completions.create(params);
    const llmMs = Date.now() - started;
    const usage = normalizeUsage(completion.usage);
    const content = completion.choices[0]?.message?.content ?? "";
    log(args.onLog, "response", `模型 OpenUI 响应完成 ${llmMs}ms`, {
      model: completion.model,
      created: completion.created,
      usage: completion.usage,
      llmMs,
      chars: content.length,
    });
    return {
      value: content,
      model: completion.model || args.model,
      llmMs,
      usage,
      providerCreatedAt: completion.created,
      cost: estimateCost(completion.model || args.model, usage),
    };
  } catch (error) {
    const failedMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    log(args.onLog, "error", `OpenUI 模型请求失败 ${failedMs}ms: ${message}`);
    if (args.provider === "hf_community") {
      throw new Error(`HF Community Endpoint 不可用、拥塞或已下线：${message}`, { cause: error });
    }
    if (args.provider === "nvidia") {
      throw new Error(`NVIDIA Build DiffusionGemma 请求失败：${message}`, { cause: error });
    }
    const rateLimited = /429|访问量过大|使用上限|rate.?limit/i.test(message);
    if (rateLimited) {
      if (args.model === "glm-4.7-flash" && args.allowModelFallback !== false) {
        log(args.onLog, "fallback", "glm-4.7-flash 服务繁忙，自动改用 glm-5.2（thinking disabled）重试一次");
        return callText({ ...args, provider: "glm", model: "glm-5.2", thinking: false, allowModelFallback: false });
      }
      throw error;
    }
    if (args.stream) {
      log(args.onLog, "fallback", "OpenUI 流式请求失败，自动回退非流式调用");
      const fallback = await callText({ ...args, stream: false, onStreamDelta: undefined });
      return { ...fallback, llmMs: failedMs + fallback.llmMs };
    }
    throw error;
  }
}

/**
 * 每步发往模型的载荷投影：只保留该步 prompt 实际引用的字段。
 * 返回给前端的完整 InferenceState 不受影响——这里只削减 token 开销。
 * ProfileDigest 是最大单一对象（① 已消费），②-⑤ 一律不再随 inference 重传。
 */
function projectForModel(step: PipelineStepName, state: InferenceState): Partial<InferenceState> {
  const pick = <K extends keyof InferenceState>(keys: K[]): Pick<InferenceState, K> =>
    Object.fromEntries(keys.map((key) => [key, state[key]])) as Pick<InferenceState, K>;
  switch (step) {
    case "evidence_resolution":
      // domainSummaries 由服务端从 digest 单独过滤传入，不随 task 重传 digest。
      return pick(["taskType", "fulfillment", "needsContext", "slotRequirements", "slots", "retrievalRequests", "requestedDomains"]);
    case "clarification":
      return pick(["taskType", "fulfillment", "slotRequirements", "slots", "conflicts"]);
    case "context_enrichment":
      // questions 不传：confirmedAnswers(qa 数组) 已单独携带问题原文+槽位+回答。
      return pick(["taskType", "fulfillment", "slotRequirements", "slots", "assumptions"]);
    case "card_plan_generate":
      return pick(["taskType", "fulfillment", "slotRequirements", "slots", "summary", "webFacts", "assumptions"]);
    default:
      return state;
  }
}

function explicitSlots(requirements: InferenceState["slotRequirements"]): InferSlot[] {
  return requirements
    .filter((slot) => slot.explicitValue)
    .map((slot) => ({
      name: slot.name,
      value: slot.explicitValue ?? "",
      evidence: "用户在请求中明确提供",
      source_record: "query",
      confidence: 1,
      status: "high" as const,
    }));
}

function completeResolvedSlots(
  requirements: InferenceState["slotRequirements"],
  resolved: InferSlot[] | undefined,
): InferSlot[] {
  const explicit = new Map(explicitSlots(requirements).map((slot) => [slot.name, slot]));
  const inferred = new Map(
    (Array.isArray(resolved) ? resolved : [])
      .filter((slot) => slot && typeof slot.name === "string")
      .map((slot) => [slot.name, slot]),
  );
  const definedNames = new Set(requirements.map((slot) => slot.name));
  const complete = requirements.map((requirement) => explicit.get(requirement.name) ?? inferred.get(requirement.name) ?? {
    name: requirement.name,
    value: "",
    evidence: "设备上下文中未找到足够可靠的证据",
    source_record: "",
    confidence: 0,
    status: "low" as const,
  });
  for (const slot of inferred.values()) {
    if (!definedNames.has(slot.name)) complete.push(slot);
  }
  return complete;
}

function criticalUncertainSlotNames(state: InferenceState): string[] {
  const requirements = new Map(state.slotRequirements.map((requirement) => [requirement.name, requirement]));
  return state.slots
    .filter((slot) => {
      const requirement = requirements.get(slot.name);
      const uncertain = !slot.value || slot.status === "low" || slot.status === "conflict" || Number(slot.confidence) < 0.75;
      const affectsPlan = !!requirement?.required || !!requirement?.blocking || Number(requirement?.weight ?? 0) >= 3;
      return uncertain && affectsPlan;
    })
    .map((slot) => slot.name);
}

function fallbackOptions(name: string, label?: string): string[] {
  const key = `${name} ${label ?? ""}`.toLowerCase();
  if (/(budget|price|cost|预算|费用)/.test(key)) return ["经济优先", "预算与品质均衡", "品质优先", "暂不限制"];
  if (/(school|学校|幼儿园)/.test(key)) return ["公办优先", "民办优先", "都可以"];
  if (/(schooltype|type|类型|性质)/.test(key)) return ["第一类优先", "第二类优先", "都可以"];
  if (/(focus|priority|侧重|重点|方向)/.test(key)) return ["基础与实用优先", "特色发展优先", "综合均衡", "暂不限制"];
  if (/(commute|distance|交通|通勤|距离)/.test(key)) return ["15分钟内", "30分钟内", "60分钟内", "暂不限制"];
  if (/(date|time|timeline|时间|日期|周期)/.test(key)) return ["尽快", "1-3个月内", "半年内", "时间灵活"];
  if (/(need|special|require|需求|特殊)/.test(key)) return ["有，需要重点考虑", "没有", "暂不确定"];
  return ["优先满足该项", "均衡考虑", "暂不限制"];
}

function ensureClarifyingQuestions(
  state: InferenceState,
  questions: InferQuestion[] | undefined,
): InferQuestion[] {
  const critical = criticalUncertainSlotNames(state);
  if (!critical.length) return [];
  const valid = (Array.isArray(questions) ? questions : []).filter((question) => {
    if (!question || typeof question.question !== "string" || !question.question.trim()) return false;
    const options = Array.isArray(question.options)
      ? question.options.filter((option): option is string => typeof option === "string" && !!option.trim())
      : [];
    if (options.length < 2) return false;
    question.options = [...new Set(options)].slice(0, 4);
    return question.options.length >= 2;
  });
  const covered = new Set<string>();
  for (const question of valid) {
    const names = Array.isArray(question.slotNames)
      ? question.slotNames.filter((name): name is string => typeof name === "string")
      : [];
    names.forEach((name) => covered.add(name));
  }
  const requirements = new Map(state.slotRequirements.map((requirement) => [requirement.name, requirement]));
  for (const name of critical) {
    if (covered.has(name)) continue;
    const requirement = requirements.get(name);
    valid.push({
      question: `请确认${requirement?.label ?? name}，以便生成符合实际约束的方案。`,
      reason: requirement?.description ?? "该信息置信度不足且会显著影响方案。",
      blocking: true,
      slotNames: [name],
      options: Array.isArray(requirement?.options) && requirement.options.length >= 2
        ? requirement.options.slice(0, 4)
        : fallbackOptions(name, requirement?.label),
    });
  }
  return valid.slice(0, 6);
}

function applyConfirmedAnswers(state: InferenceState, answers: Record<number, string>): InferenceState {
  const answered = new Map<string, string>();
  (state.questions ?? []).forEach((question, index) => {
    const answer = String(answers[index] ?? "").trim();
    if (!answer) return;
    const slotNames = Array.isArray(question.slotNames)
      ? question.slotNames.filter((name): name is string => typeof name === "string")
      : [];
    slotNames.forEach((name) => answered.set(name, answer));
  });
  if (!answered.size) return state;
  return {
    ...state,
    slots: state.slots.map((slot) => answered.has(slot.name) ? {
      ...slot,
      value: answered.get(slot.name) ?? slot.value,
      evidence: `用户明确回答“${answered.get(slot.name)}”`,
      source_record: "user_answer",
      confidence: 1,
      status: "high",
    } : slot),
  };
}

function buildTaskSearchQuery(state: InferenceState): string {
  const values = state.slots
    .filter((slot) => slot.value && Number(slot.confidence) >= 0.7)
    .slice(0, 10)
    .map((slot) => `${slot.name}:${String(slot.value)}`)
    .join(" ");
  const target = state.fulfillment?.outcome === "actionable"
    ? "具体实体 推荐 可用详情或交易入口"
    : state.fulfillment?.outcome === "verified_recommendations"
      ? "具体实体 真实推荐 来源链接"
      : "实用建议 可靠来源";
  return `${state.taskType} ${values} ${target}`.trim();
}

function refineFulfillment(state: InferenceState, query: string): InferenceState {
  const context = `${query} ${state.slots.map((slot) => String(slot.value ?? "")).join(" ")}`;
  if (/自己做|下厨|做饭|菜谱|食谱/i.test(context)) {
    return { ...state, fulfillment: { outcome: "ideas", requiresFreshData: false, requiresLocation: false, requiresActionLink: false } };
  }
  if (/外卖|订餐|餐厅|到店|预订|预约|下单|购买|购票|酒店/i.test(context)) {
    return { ...state, fulfillment: { outcome: "actionable", requiresFreshData: true, requiresLocation: true, requiresActionLink: true } };
  }
  if (/推荐|吃什么|去哪|看什么|买什么|选择/i.test(context)) {
    return { ...state, fulfillment: { outcome: "verified_recommendations", requiresFreshData: true, requiresLocation: !!state.fulfillment?.requiresLocation, requiresActionLink: false } };
  }
  return state;
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * 从 provider 原始 web_search 返回结构中容错提取全部合法 URL。
 * provider 字段名不保证稳定（link/url/source/icon 等），因此做全树字符串遍历；
 * 该集合作为不可伪造的 source registry，约束 ⑤ 的 external-link allowlist。
 */
function extractUrlsFromSearch(webSearch: unknown): string[] {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      const url = validHttpUrl(value.includes("://") ? value : "");
      if (url) found.add(url);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(webSearch);
  return [...found];
}

function graphFromPlan(plan: CardPlan, slots: InferSlot[]): string {
  const lines = ["flowchart LR"];
  const slotIds = new Map(slots.map((slot, index) => [slot.name, `S${index}`]));
  slots.forEach((slot, index) => lines.push(`  S${index}["${slot.name}=${String(slot.value).replaceAll('"', "'")}"]`));
  plan.cards.forEach((card, cardIndex) => {
    lines.push(`  C${cardIndex}["${String(card.purpose ?? `卡片 ${cardIndex + 1}`).replaceAll('"', "'")}"]`);
    const refs = new Set<string>(card.sourceSlots ?? []);
    card.blocks.forEach((block) => {
      if (block.valueFromSlot) refs.add(block.valueFromSlot);
      if (block.itemsFromSlot) refs.add(block.itemsFromSlot);
      block.sourceSlots?.forEach((ref) => refs.add(ref));
    });
    refs.forEach((ref) => {
      const slotId = slotIds.get(ref);
      if (slotId) lines.push(`  ${slotId} --> C${cardIndex}`);
    });
    if (cardIndex > 0) lines.push(`  C${cardIndex - 1} --> C${cardIndex}`);
  });
  return lines.join("\n");
}

function normalizeCardPlan(plan: CardPlan, allowedExternalUrls: Set<string>, validSlotNames: Set<string>): CardPlan {
  const validRoles = new Set(["primary", "secondary", "tertiary"]);
  const validBlockKinds = new Set(["text", "hero", "summary", "list", "progress", "status", "metric", "choice", "toggle", "image", "chart", "infographic"]);
  const cards = normalizeCardSequence(plan.cards);
  const cardIds = new Set(cards.map((card) => card.id));
  const validSlot = (value: unknown): value is string => typeof value === "string" && validSlotNames.has(value);
  return {
    ...plan,
    cards: cards.map((card) => ({
      ...card,
      title: conciseCardTitle(
        typeof card.title === "string" && card.title.trim()
          ? card.title.trim()
          : card.purpose,
      ),
      purpose: typeof card.purpose === "string" && card.purpose.trim()
        ? card.purpose.trim()
        : "未命名卡片",
      presentation: normalizeCardPresentation(card.presentation),
      sourceSlots: Array.isArray(card.sourceSlots) ? card.sourceSlots.filter(validSlot) : undefined,
      blocks: (Array.isArray(card.blocks) ? card.blocks : []).slice(0, 5).map((block) => ({
        ...block,
        kind: validBlockKinds.has(String(block.kind)) ? block.kind : "text",
        assetRequest: normalizeAssetRequest(block.assetRequest),
        valueFromSlot: validSlot(block.valueFromSlot) ? block.valueFromSlot : undefined,
        itemsFromSlot: validSlot(block.itemsFromSlot) ? block.itemsFromSlot : undefined,
        currentFromSlot: validSlot(block.currentFromSlot) ? block.currentFromSlot : undefined,
        sourceSlots: Array.isArray(block.sourceSlots) ? block.sourceSlots.filter(validSlot) : undefined,
        items: Array.isArray(block.items) ? block.items.map((item) => {
          const raw = item as unknown as { label?: unknown; title?: unknown; detail?: unknown; onSelect?: typeof item.onSelect };
          return {
            label: String(raw.label ?? raw.title ?? "未命名项目"),
            ...(raw.detail ? { detail: String(raw.detail) } : {}),
            ...(raw.onSelect ? { onSelect: {
              ...raw.onSelect,
              ...(!raw.onSelect.thenGoTo || cardIds.has(raw.onSelect.thenGoTo) ? {} : { thenGoTo: undefined }),
            } } : {}),
          };
        }) : undefined,
      })),
      actions: Array.isArray(card.actions) ? card.actions
        .filter((action) => action && typeof action.id === "string" && typeof action.label === "string")
        .filter((action) => !action.targetCardId || cardIds.has(action.targetCardId))
        .filter((action) => action.type !== "external-link" || (!!validHttpUrl(action.link) && allowedExternalUrls.has(String(action.link).trim())))
        .map((action) => ({ ...action, role: validRoles.has(String(action.role)) ? action.role : "secondary" as const })) : undefined,
    })),
  };
}

function addUsage(left?: TokenUsage, right?: TokenUsage): TokenUsage | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    prompt: left.prompt + right.prompt,
    completion: left.completion + right.completion,
    total: left.total + right.total,
    cached: left.cached + right.cached,
  };
}

function mockResult(input: RunInput): Omit<PipelineStepOutput, "durationMs" | "timing" | "model"> {
  const slot: InferSlot = { name: "request", value: input.query, evidence: "用户明确输入", source_record: "query", confidence: 1, status: "high" };
  const state: InferenceState = {
    taskType: "通用方案生成", needsContext: false,
    slotRequirements: [{ name: "request", description: "用户目标", required: true, explicitValue: input.query }],
    slots: [slot], conflicts: [], questions: [], assumptions: [],
  };
  const layoutMode = normalizeCardLayoutMode(input.layoutMode);
  const rawPlan: CardPlan = input.cardPlan ?? {
    skillName: input.query,
    iconText: "S",
    reasoning: "根据简单 mock 意图生成一张完整卡片",
    cards: [
      {
        id: "overview",
        purpose: "完整方案",
        sourceSlots: ["request"],
        blocks: [
          { kind: "hero", title: input.query, text: "已整理目标与推荐方向", sourceSlots: ["request"] },
          { kind: "list", title: "执行要点", items: [{ label: "先确认最重要的目标" }, { label: "再按优先级推进" }], sourceSlots: ["request"] },
          { kind: "summary", title: "行动建议", text: "从第一项开始执行，并根据结果继续调整。", sourceSlots: ["request"] },
        ],
      },
    ],
  };
  const { plan, diagnostics: layoutPlanningDiagnostics } = fitCardPlanToLayout(rawPlan, layoutMode);
  const table: Record<PipelineStepName, Omit<PipelineStepOutput, "durationMs" | "timing" | "model">> = {
    intent_analysis: { name: input.name, reasoning: "识别任务及最小槽位（mock）", outputs: { taskType: state.taskType, needsContext: false }, inferenceState: state, slots: state.slots },
    evidence_resolution: { name: input.name, reasoning: "无需额外上下文（mock）", outputs: {}, inferenceState: input.inferenceState ?? state, slots: (input.inferenceState ?? state).slots, conflicts: [], questions: [] },
    clarification: { name: input.name, reasoning: "没有需要澄清的关键槽位（mock）", outputs: { questionCount: 0 }, inferenceState: input.inferenceState ?? state, slots: (input.inferenceState ?? state).slots, questions: [] },
    context_enrichment: { name: input.name, reasoning: "完成总结与能力补齐（mock）", outputs: { summary: "mock summary", capabilityCalls: [] }, inferenceState: { ...(input.inferenceState ?? state), summary: "mock summary", webFacts: [], capabilityCalls: [] }, slots: (input.inferenceState ?? state).slots },
    card_plan_generate: { name: input.name, reasoning: plan.reasoning, outputs: { cardCount: plan.cards.length, layoutPlanningDiagnostics }, cardPlan: plan, cardPlanMarkdown: cardPlanToVibeMarkdown(plan), reasoningGraph: graphFromPlan(plan, input.inferenceState?.slots ?? [slot]), result: { summary: plan.skillName, assumptions: input.inferenceState?.assumptions ?? [] } },
    openui_generate: {
      name: input.name,
      reasoning: "生成可编译 OpenUI Lang（mock）",
      outputs: { mock: true },
      openuiCode: mockOpenUIFromCardPlan(plan),
      openuiDiagnostics: {
        coverage: { required: 0, matched: 0, missing: [] },
        assetCoverage: { valid: true, required: 0, matched: 0, missing: [], errors: [] },
        layoutCoverage: { mode: layoutMode, valid: true, checkedCards: plan.cards.length, withinBudget: plan.cards.length, violations: [] },
        parser: { statements: plan.cards.length * 3 + 2, unresolved: [], orphaned: [], incomplete: false },
        repaired: false,
        repairTriggered: false,
      },
    },
  };
  return table[input.name];
}

export async function runPipelineStep(input: RunInput): Promise<PipelineStepOutput> {
  const started = Date.now();
  const selectedModel = resolveModelProfile(input.modelProfile ?? DEFAULT_PROFILES[input.name]);
  const sampling = input.skillContext?.executionStrategy === "weak-delta" || input.skillContext?.executionStrategy === "weak-full"
    ? { temperature: 0, doSample: false }
    : STEP_SAMPLING[input.name];
  const classification = input.adaptiveContext?.classification ?? input.classification ?? classifyQuery(input.query);
  const profileView: ProfileViewV2 | undefined = FEATURE_FLAGS.PROFILE_VIEW_V2 && input.name === "intent_analysis" && input.profileDigest
    ? buildProfileView({
        query: input.query,
        digest: input.profileDigest,
        deviceContext: input.profileSourceText ? undefined : input.deviceContext,
        freeText: input.profileSourceText,
        profileOverlay: input.adaptiveContext?.profileOverlay,
      })
    : undefined;
  const reusablePrior = skillPriorText(input.skillContext);
  const steering = { steeringHint: [input.adaptiveContext?.stepHint, reusablePrior].filter(Boolean).join("\n\n") || undefined };
  log(input.onLog, "request", "Adaptive policy context", {
    policyId: input.adaptiveContext?.policyId,
    policyVersion: input.adaptiveContext?.policyVersion,
    taskFamily: classification.taskFamily,
    decisionMode: classification.decisionMode,
    steeringHint: input.adaptiveContext?.stepHint ?? "",
  });
  if (profileView) {
    log(input.onLog, "request", "ProfileView V2 built", {
      oldDigestChars: profileView.budget.oldDigestChars,
      profileViewChars: profileView.budget.profileViewChars,
      selectedDetailCount: profileView.selectedDetails.length,
      selectedDomains: [...new Set(profileView.selectedDetails.map((detail) => detail.domain))],
    });
  }
  if (input.skillContext?.mode === "deterministic") {
    const deterministic = input.name === "intent_analysis"
      ? deterministicIntent(input.skillContext, input.profileDigest)
      : input.name === "clarification" && input.inferenceState
        ? deterministicClarification(input.skillContext, input.inferenceState)
        : input.name === "context_enrichment" && input.inferenceState
          ? deterministicEnrichment(input.skillContext, input.inferenceState, input.userAnswers ?? {})
          : null;
    if (deterministic) {
      const callsAvoided = input.name === "clarification" && !(deterministic.questions?.length) ? 0 : 1;
      const totalMs = Math.max(1, Date.now() - started);
      const output: PipelineStepOutput = {
        name: input.name,
        reasoning: deterministic.reasoning,
        outputs: { skillDeterministic: true, callsAvoided, questionCount: deterministic.questions?.length ?? 0 },
        inferenceState: deterministic.state,
        slots: deterministic.state.slots,
        conflicts: deterministic.state.conflicts,
        questions: deterministic.questions ?? deterministic.state.questions,
        durationMs: totalMs,
        timing: { totalMs, llmMs: 0, overheadMs: totalMs },
        model: `skill:${input.skillContext.selection.skillVersionId}`,
        modelProfile: input.modelProfile ?? DEFAULT_PROFILES[input.name],
        skillReuse: {
          skillId: input.skillContext.selection.skillId,
          skillVersionId: input.skillContext.selection.skillVersionId,
          recipeFingerprint: input.skillContext.selection.recipeFingerprint,
          score: input.skillContext.selection.score,
          activation: input.skillContext.selection.activation,
          matcherVersion: input.skillContext.selection.matcherVersion,
          matcherModel: input.skillContext.selection.matcherModel,
          executionMode: "deterministic",
          callsAvoided,
          reuseTier: input.skillContext.reuseTier,
          executionStrategy: input.skillContext.executionStrategy,
          profileSimilarity: input.skillContext.profileSimilarity,
          ...describeSkillReuseEffect(input.name, input.skillContext, "deterministic", callsAvoided),
        },
      };
      output.provenance = summarizeStepForProvenance(input.name, { classification, adaptiveContext: input.adaptiveContext, profileView, inputState: input.inferenceState, output });
      return output;
    }
  }
  if (input.mock) {
    const base = mockResult(input);
    if (input.name === "openui_generate" && input.stream && base.openuiCode && input.onStreamDelta) {
      let cumulativeChars = 0;
      const chunks = base.openuiCode.match(/[^\n]*\n|[^\n]+$/g) ?? [base.openuiCode];
      for (const chunk of chunks) {
        cumulativeChars += chunk.length;
        input.onStreamDelta(chunk, cumulativeChars);
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
    }
    const totalMs = Math.max(1, Date.now() - started);
    const provenance = summarizeStepForProvenance(input.name, { classification, adaptiveContext: input.adaptiveContext, profileView, inputState: input.inferenceState, output: base, cardPlan: base.cardPlan ?? input.cardPlan, cardPlanMarkdown: base.cardPlanMarkdown, openuiCode: base.openuiCode });
    return {
      ...base,
      adaptive: input.adaptiveContext ? { policyId: input.adaptiveContext.policyId, policyVersion: input.adaptiveContext.policyVersion, classification, steeringHint: input.adaptiveContext.stepHint } : undefined,
      skillReuse: input.skillContext ? {
        skillId: input.skillContext.selection.skillId, skillVersionId: input.skillContext.selection.skillVersionId,
        recipeFingerprint: input.skillContext.selection.recipeFingerprint, score: input.skillContext.selection.score,
        activation: input.skillContext.selection.activation,
        matcherVersion: input.skillContext.selection.matcherVersion,
        matcherModel: input.skillContext.selection.matcherModel,
        executionMode: input.skillContext.mode === "deterministic" ? "fallback" : "guided",
        callsAvoided: 0, fallbackReason: input.skillContext.mode === "deterministic" ? "deterministic_preconditions_not_met" : undefined,
        reuseTier: input.skillContext.reuseTier,
        executionStrategy: input.skillContext.executionStrategy,
        profileSimilarity: input.skillContext.profileSimilarity,
        ...describeSkillReuseEffect(
          input.name,
          input.skillContext,
          input.skillContext.mode === "deterministic" ? "fallback" : "guided",
          0,
          input.skillContext.mode === "deterministic" ? "deterministic_preconditions_not_met" : undefined,
          false,
        ),
      } : undefined,
      provenance, model: "mock", modelProfile: input.modelProfile ?? DEFAULT_PROFILES[input.name], durationMs: totalMs,
      timing: { totalMs, llmMs: 0, overheadMs: totalMs },
    };
  }

  let llm: LLMResult;
  let base: Omit<PipelineStepOutput, "durationMs" | "timing" | "model" | "usage" | "cost">;
  let retrievedEvidenceForProvenance: RetrievedEvidence[] | undefined;
  let skillExecutionMode: NonNullable<PipelineStepOutput["skillReuse"]>["executionMode"] = input.skillContext ? "guided" : "normal";
  let skillCallsAvoided = 0;
  let skillFallbackReason: string | undefined;
  const deterministicResult = input.skillContext?.mode === "deterministic"
    ? input.name === "intent_analysis"
      ? deterministicIntent(input.skillContext, input.profileDigest)
      : input.name === "clarification" && input.inferenceState
        ? deterministicClarification(input.skillContext, input.inferenceState)
        : input.name === "context_enrichment" && input.inferenceState
          ? deterministicEnrichment(input.skillContext, input.inferenceState, input.userAnswers ?? {})
          : null
    : null;
  if (input.skillContext?.mode === "deterministic" && !deterministicResult) {
    skillExecutionMode = "fallback";
    skillFallbackReason = "deterministic_preconditions_not_met";
    log(input.onLog, "fallback", "Skill 确定性执行条件不完整，回退本步骤原始模型链路");
  }

  if (deterministicResult) {
    skillExecutionMode = "deterministic";
    skillCallsAvoided = input.name === "clarification" && !(deterministicResult.questions?.length) ? 0 : 1;
    llm = { value: {}, model: `skill:${input.skillContext!.selection.skillVersionId}`, llmMs: 0 };
    base = {
      name: input.name,
      reasoning: deterministicResult.reasoning,
      outputs: {
        skillDeterministic: true,
        callsAvoided: skillCallsAvoided,
        taskType: deterministicResult.state.taskType,
        slotCount: deterministicResult.state.slotRequirements.length,
        questionCount: deterministicResult.questions?.length ?? 0,
        summary: deterministicResult.state.summary,
      },
      inferenceState: deterministicResult.state,
      slots: deterministicResult.state.slots,
      conflicts: deterministicResult.state.conflicts,
      questions: deterministicResult.questions ?? deterministicResult.state.questions,
    };
  } else if (input.name === "intent_analysis") {
    llm = await callJson({
      ...selectedModel, ...sampling, ...steering, onLog: input.onLog,
      system: "你负责根据用户请求和 query-independent 通用画像胶囊建立任务模型。taskType 必须是任务领域名称（如饮食推荐/职业决策/旅行规划），不能写 ideas/actionable；交付等级单独写 fulfillment。先判断用户最终要灵感、经验证的具体推荐，还是可执行动作；再从最终交付物反推所有会影响内容、排序、约束、个性化和外部检索的槽位。画像胶囊只用于发现可用领域和候选槽位，不可直接当作最终证据。必须输出 requestedDomains 和 retrievalRequests，让下一阶段按需回查原始记录；每个 semanticQuery 必须同时包含中文关键词和对应英文关键词，以空格分隔，提升对中英文 JSON path/value 的召回。通常覆盖时间、地点、对象、预算、偏好、限制和交付方式；不要用固定槽位数量截断。对可能需要用户确认的槽位提供2-4个互斥 options。只把 query 明示内容写入 explicitValue。",
      user: FEATURE_FLAGS.PROFILE_VIEW_V2 ? { query: input.query, profileView } : { query: input.query, profileDigest: input.profileDigest },
      schemaHint: "{reasoning:string,taskType:string,fulfillment:{outcome:'ideas'|'verified_recommendations'|'actionable',requiresFreshData:boolean,requiresLocation:boolean,requiresActionLink:boolean},needsContext:boolean,requestedDomains:string[],retrievalRequests:[{slotNames:string[],domains:string[],sourcePaths?:string[],semanticQuery:string,recency?:string}],slotRequirements:[{name:string,label:string,description:string,weight:number,required:boolean,blocking:boolean,options?:string[2-4],explicitValue?:string}]} ",
    });
    const raw = llm.value as Partial<InferenceState> & { reasoning?: string };
    const requirements = Array.isArray(raw.slotRequirements) ? raw.slotRequirements : [];
    const slots = explicitSlots(requirements);
    const hasUnresolvedSlots = requirements.some((requirement) => !requirement.explicitValue);
    const state: InferenceState = {
      taskType: raw.taskType ?? "通用任务",
      fulfillment: raw.fulfillment,
      needsContext: !!raw.needsContext || hasUnresolvedSlots,
      requestedDomains: Array.isArray(raw.requestedDomains) ? raw.requestedDomains : [],
      retrievalRequests: Array.isArray(raw.retrievalRequests) ? raw.retrievalRequests : [],
      profileDigest: input.profileDigest,
      slotRequirements: requirements, slots, conflicts: [], questions: [], assumptions: [],
    };
    base = { name: input.name, reasoning: raw.reasoning ?? "完成任务建模与检索规划", outputs: { taskType: state.taskType, fulfillment: state.fulfillment, needsContext: state.needsContext, requestedDomains: state.requestedDomains, retrievalRequests: state.retrievalRequests, slotRequirements: requirements, profileViewBudget: profileView?.budget }, inferenceState: state, slots };
  } else if (input.name === "evidence_resolution") {
    if (!input.inferenceState) throw new Error("缺少 intent_analysis 的 inferenceState");
    if (!input.inferenceState.needsContext) {
      const state = { ...input.inferenceState, conflicts: [], questions: [] };
      llm = { value: {}, model: "skipped", llmMs: 0 };
      base = { name: input.name, reasoning: "必需信息已由用户明确提供，跳过设备上下文模型调用。", outputs: { skipped: true }, inferenceState: state, slots: state.slots, conflicts: [], questions: [] };
    } else {
      const retrievedEvidence = retrieveProfileEvidence(input.deviceContext, input.inferenceState.retrievalRequests ?? []);
      retrievedEvidenceForProvenance = retrievedEvidence;
      const requestedDomainSet = new Set((input.inferenceState.requestedDomains ?? []).map((domain) => domain.toLowerCase()));
      const domainSummaries = (input.inferenceState.profileDigest?.domains ?? []).filter((domain) => requestedDomainSet.has(domain.name.toLowerCase()));
      llm = await callJson({
        ...selectedModel, ...sampling, ...steering, onLog: input.onLog,
        system: "你负责使用按需披露的领域摘要和原始证据完成槽位解析与冲突检测。必须返回每个 slotRequirements 槽位；允许发现并补充第一阶段遗漏、但会显著影响最终交付或检索的槽位。只有 retrievedEvidence 中的原始记录可作为最终事实证据；领域摘要只能帮助解释。用户明示值优先。本阶段不提问、不替用户选择偏好。",
        user: { query: input.query, task: projectForModel(input.name, input.inferenceState), domainSummaries, retrievedEvidence },
        schemaHint: "{reasoning:string,slots:[{name,value,evidence,source_record,confidence,status}],discoveredRequirements?:[{name,label,description,weight,required,blocking,options?}],conflicts:[{slot,evidence_a,evidence_b,note}],assumptions:[string]} ",
      });
      const raw = llm.value as { reasoning?: string; slots?: InferSlot[]; discoveredRequirements?: InferenceState["slotRequirements"]; conflicts?: InferConflict[]; assumptions?: string[] };
      const discovered = Array.isArray(raw.discoveredRequirements) ? raw.discoveredRequirements : [];
      const requirementNames = new Set(input.inferenceState.slotRequirements.map((requirement) => requirement.name));
      const requirements = [...input.inferenceState.slotRequirements, ...discovered.filter((requirement) => requirement?.name && !requirementNames.has(requirement.name))];
      const state: InferenceState = { ...input.inferenceState, slotRequirements: requirements, slots: completeResolvedSlots(requirements, raw.slots), conflicts: raw.conflicts ?? [], questions: [], assumptions: raw.assumptions ?? [] };
      base = { name: input.name, reasoning: raw.reasoning ?? "完成渐进披露证据解析", outputs: { retrievedEvidenceCount: retrievedEvidence.length, disclosedDomains: domainSummaries.map((domain) => domain.name), discoveredSlotCount: requirements.length - input.inferenceState.slotRequirements.length, resolvedSlots: state.slots.length, conflictCount: state.conflicts.length }, inferenceState: state, slots: state.slots, conflicts: state.conflicts, questions: [] };
    }
  } else if (input.name === "clarification") {
    if (!input.inferenceState) throw new Error("缺少 evidence_resolution 的 inferenceState");
    const uncertainNames = criticalUncertainSlotNames(input.inferenceState);
    if (!uncertainNames.length) {
      const state = { ...input.inferenceState, questions: [] };
      llm = { value: {}, model: "skipped", llmMs: 0 };
      base = { name: input.name, reasoning: "没有会显著影响方案的低置信或冲突槽位，跳过提问。", outputs: { skipped: true, uncertainSlotCount: 0 }, inferenceState: state, slots: state.slots, questions: [] };
    } else {
      llm = await callJson({
        ...selectedModel, ...sampling, ...steering, onLog: input.onLog,
        system: "你负责在生成方案前完成最小化澄清。只针对给定 uncertainSlotNames 提问；可以把高度相关槽位合并成一个问题，但 questions.slotNames 必须覆盖每个不确定槽位。所有问题都必须是选择题并提供2-4个简短、互斥、覆盖常见情况的 options，禁止填空题或省略 options；必要时加入“暂不限制/暂不确定”。不得把这些问题延迟到最终卡片或 OpenUI。",
        user: { query: input.query, inference: projectForModel(input.name, input.inferenceState), uncertainSlotNames: uncertainNames },
        schemaHint: "{reasoning:string,questions:[{question:string,reason:string,blocking:true,slotNames:string[],options:string[2-4]}]} ",
      });
      const raw = llm.value as { reasoning?: string; questions?: InferQuestion[] };
      const questions = ensureClarifyingQuestions(input.inferenceState, raw.questions);
      const state = { ...input.inferenceState, questions };
      base = { name: input.name, reasoning: raw.reasoning ?? "已生成最小化澄清问题", outputs: { uncertainSlotCount: uncertainNames.length, questionCount: questions.length }, inferenceState: state, slots: state.slots, questions };
    }
  } else if (input.name === "context_enrichment") {
    if (!input.inferenceState) throw new Error("缺少 clarification 的 inferenceState");
    const questions = input.inferenceState.questions ?? [];
    const answers = input.userAnswers ?? {};
    const unanswered = questions.filter((_, index) => !String(answers[index] ?? "").trim());
    if (unanswered.length) throw new Error(`仍有 ${unanswered.length} 个澄清问题未回答，不能进入能力补齐`);
    const qa = questions.map((question, index) => ({
      question: question.question,
      slotNames: question.slotNames,
      answer: answers[index],
    }));
    const mergedState = refineFulfillment(applyConfirmedAnswers(input.inferenceState, answers), input.query);
    const searchQuery = buildTaskSearchQuery(mergedState);
    const shouldSearch = !!mergedState.fulfillment?.requiresFreshData || mergedState.fulfillment?.outcome !== "ideas";
    // 暂停期预取只有在用户回答未改变最终 searchQuery 时才命中；否则安全回退到即时搜索。
    const prefetchedHit = shouldSearch
      && !!input.prefetchedSearch
      && input.prefetchedSearch.searchQuery === searchQuery
      && input.prefetchedSearch.webSearchRaw != null;
    if (shouldSearch && input.prefetchedSearch && !prefetchedHit) {
      log(input.onLog, "fallback", `预取搜索词与当前不一致（预取="${input.prefetchedSearch.searchQuery.slice(0, 50)}" / 当前="${searchQuery.slice(0, 50)}"），回退到即时搜索`);
    }
    if (prefetchedHit) {
      log(input.onLog, "response", "命中暂停期预取搜索，跳过 web_search 工具调用");
    }
    llm = await callJson({
      ...selectedModel, ...sampling, ...steering, webSearchQuery: shouldSearch && !prefetchedHit ? searchQuery : undefined, onLog: input.onLog,
      system: "你负责在方案生成前汇总已确认事实，并在需要时用唯一一次联网搜索取得最终交付所需的具体实体和可用入口。用户回答已由代码写回 slots，不得覆盖。搜索必须围绕任务、时间、地点、预算、偏好、限制和 fulfillment；不要把普通任务改写成政策/注意事项查询。对于餐饮等本地推荐，应优先返回真实具体的商家或菜品。sources/sourceUrl/actionUrl 只能原样来自搜索工具结果，禁止拼接或猜测。只有明确的交易深链才标 order/reserve，否则 actionKind=details。无法取得有效实体时透明降级，不得虚构。"
        + (prefetchedHit ? "本次联网搜索结果已在 user.searchResults 中原样提供，无需也无法再次发起搜索；sources/sourceUrl/actionUrl 只能原样来自这份结果。" : ""),
      user: {
        currentDate: new Date().toISOString().slice(0, 10),
        query: input.query,
        inference: projectForModel(input.name, mergedState),
        confirmedAnswers: qa,
        publicSearchQuery: shouldSearch ? searchQuery : null,
        searchBudget: { used: shouldSearch ? 1 : 0, max: 1 },
        ...(prefetchedHit ? { searchResults: input.prefetchedSearch?.webSearchRaw } : {}),
      },
      schemaHint: "{reasoning:string,summary:string,slots:[{name,value,evidence,source_record,confidence,status}],assumptions:string[],webFacts:[{query:string,summary:string,sources?:string[],entities?:[{name:string,category?:string,description:string,locality?:string,sourceUrl:string,actionUrl?:string,actionKind:'order'|'reserve'|'details'}]}],capabilityCalls:[{capability:'web_search'|'llm_reasoning',query:string,status:'success'|'skipped'|'error'}]} ",
    });
    const raw = llm.value as { reasoning?: string; summary?: string; slots?: InferSlot[]; assumptions?: string[]; webFacts?: InferenceState["webFacts"]; capabilityCalls?: InferenceState["capabilityCalls"] };
    const providerSearchUrls = shouldSearch
      ? extractUrlsFromSearch(prefetchedHit ? input.prefetchedSearch?.webSearchRaw : llm.webSearch)
      : [];
    const state: InferenceState = {
      ...mergedState,
      slots: completeResolvedSlots(mergedState.slotRequirements, raw.slots),
      assumptions: raw.assumptions ?? mergedState.assumptions,
      summary: raw.summary ?? "已汇总确认信息与公开事实",
      webFacts: raw.webFacts ?? [],
      capabilityCalls: raw.capabilityCalls ?? [{ capability: "web_search", query: searchQuery, status: shouldSearch ? "success" : "skipped" }],
      providerSearchUrls,
    };
    const verifiedEntityCount = (state.webFacts ?? []).reduce((count, fact) => count + (fact.entities?.length ?? 0), 0);
    const actionableLinkCount = (state.webFacts ?? []).flatMap((fact) => fact.entities ?? []).filter((entity) => !!entity.actionUrl).length;
    base = { name: input.name, reasoning: raw.reasoning ?? "完成上下文总结与任务型能力补齐", outputs: { summary: state.summary, searchQuery: shouldSearch ? searchQuery : null, searchBudgetUsed: shouldSearch ? 1 : 0, prefetchUsed: prefetchedHit, verifiedEntityCount, actionableLinkCount, providerUrlCount: providerSearchUrls.length, webFacts: state.webFacts, capabilityCalls: state.capabilityCalls, providerSearchResults: prefetchedHit ? input.prefetchedSearch?.webSearchRaw : llm.webSearch }, inferenceState: state, slots: state.slots, questions: state.questions };
  } else if (input.name === "card_plan_generate") {
    if (!input.inferenceState) throw new Error("缺少 evidence_resolution 的 inferenceState");
    if (!input.inferenceState.summary) throw new Error("请先完成不确定性提问和上下文能力补齐，再生成 CardPlan");
    const layoutMode = normalizeCardLayoutMode(input.layoutMode);
    const layoutPrompt = cardPlanSystemPromptFor(layoutMode);
    const cardPlanCall = {
      ...selectedModel, ...sampling, ...steering, onLog: input.onLog,
      system: FEATURE_FLAGS.WEB_FACTS_OPTIONAL
        ? layoutPrompt
        : `${layoutPrompt}\n兼容模式：若 webFacts 非空，必须把其中与任务有关的事实纳入现有业务卡，但仍不得为来源单独增加卡片。`,
      user: { query: input.query, inference: projectForModel(input.name, input.inferenceState), answers: input.userAnswers ?? {}, layoutPolicy: cardLayoutPolicy(layoutMode) },
      schemaHint: CARD_PLAN_SCHEMA_HINT,
    };
    try {
      llm = await callJson(cardPlanCall);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!/JSON|解析|模型返回空内容|Unexpected end|position \d+/i.test(reason)) throw error;
      log(input.onLog, "fallback", `CardPlan JSON 重试 [json_retry] · ${reason}`);
      llm = await callJson({
        ...cardPlanCall,
        thinking: false,
        temperature: 0,
        doSample: false,
        system: `${cardPlanCall.system}\n\n上一次输出不是完整合法 JSON。重新生成同一 CardPlan；严格闭合所有对象和数组，不输出代码围栏或解释文字。`,
      });
      log(input.onLog, "response", "CardPlan JSON 重试成功 [json_retry]");
    }
    const cardPlanFallbacks = {
      skillName: input.inferenceState.taskType || input.query.slice(0, 40) || "生成结果",
      reasoning: "基于当前推断状态生成卡片计划。",
    };
    let envelope = normalizeCardPlanEnvelope(llm.value, cardPlanFallbacks);
    if (envelope.plan) {
      log(input.onLog, "response", `CardPlan 结构校验通过 · cards=${envelope.diagnostics.cardCount} · repairs=${envelope.diagnostics.repairs.length}`, envelope.diagnostics);
    } else {
      log(input.onLog, "error", `CardPlan 结构失败 [cardplan_shape] · ${envelope.diagnostics.issues.join(", ")}`, envelope.diagnostics);
      log(input.onLog, "fallback", "CardPlan 结构修复 [cardplan_repair] · 使用当前模型低温重试一次");
      const first = llm;
      const repair = await callJson({
        ...selectedModel,
        thinking: false,
        temperature: 0,
        doSample: false,
        steeringHint: input.adaptiveContext?.stepHint,
        onLog: input.onLog,
        system: `${layoutPrompt}\n\n你正在修复一次结构不合规的 CardPlan JSON。只修复字段外壳、必填字段与类型，不改变用户任务、卡片语义、动作和媒体意图。`,
        user: {
          query: input.query,
          invalidCardPlanResponse: llm.value,
          validationIssues: envelope.diagnostics.issues,
          layoutPolicy: cardLayoutPolicy(layoutMode),
        },
        schemaHint: CARD_PLAN_SCHEMA_HINT,
      });
      llm = {
        ...repair,
        model: `${first.model} → ${repair.model}`,
        llmMs: first.llmMs + repair.llmMs,
        usage: addUsage(first.usage, repair.usage),
        cost: (first.cost ?? 0) + (repair.cost ?? 0),
      };
      envelope = normalizeCardPlanEnvelope(repair.value, cardPlanFallbacks);
      if (!envelope.plan) {
        log(input.onLog, "error", `CardPlan 修复失败 [cardplan_repair] · ${envelope.diagnostics.issues.join(", ")}`, envelope.diagnostics);
        throw new Error(`CardPlan 结构修复失败：${envelope.diagnostics.issues.join(", ")}`);
      }
      log(input.onLog, "response", `CardPlan 结构修复成功 · cards=${envelope.diagnostics.cardCount} · repairs=${envelope.diagnostics.repairs.length}`, envelope.diagnostics);
    }
    const rawPlan = envelope.plan;
    if (!rawPlan) throw new Error("CardPlan 结构归一化未产生可用计划");
    // allowlist 优先采用 provider 原始搜索 URL（不可伪造）；
    // provider 结果缺失时退回模型结构化的 webFacts URL 并在日志标注。
    const webFactUrls = (input.inferenceState.webFacts ?? []).flatMap((fact) => [
      ...(fact.sources ?? []),
      ...(fact.entities ?? []).flatMap((entity) => [entity.sourceUrl, entity.actionUrl].filter((url): url is string => typeof url === "string")),
    ]).map((url) => validHttpUrl(url)).filter((url): url is string => !!url);
    const providerUrls = (input.inferenceState.providerSearchUrls ?? []).map((url) => validHttpUrl(url)).filter((url): url is string => !!url);
    const useProviderRegistry = providerUrls.length > 0;
    const allowedExternalUrls = new Set(useProviderRegistry ? providerUrls : webFactUrls);
    log(input.onLog, "response", useProviderRegistry
      ? `URL allowlist 使用 provider 原始结果（${providerUrls.length} 条），模型 webFacts 中 ${webFactUrls.length} 条将按此过滤`
      : `URL allowlist 退回模型 webFacts（${webFactUrls.length} 条）——本次无 provider 原始搜索结果`);
    const validSlotNames = new Set(input.inferenceState.slots.map((slot) => slot.name));
    const normalizedPlan = sanitizeCardPlanExternalLinks(normalizeCardPlan(rawPlan, allowedExternalUrls, validSlotNames), allowedExternalUrls);
    const mediaPlanning = ensureAssetRequests(normalizedPlan, input.query);
    log(input.onLog, "request", `CardPlan 布局装箱 [layout_pack] · mode=${layoutMode} · inputCards=${mediaPlanning.plan.cards.length}`);
    const fitted = fitCardPlanToLayout(mediaPlanning.plan, layoutMode);
    if (!fitted.diagnostics.valid) {
      const details = fitted.diagnostics.cards.filter((card) => !card.fits).map((card) => `${card.cardId}: ${card.reasons.join(", ")}`).join("；");
      log(input.onLog, "error", `CardPlan 布局失败 [layout_pack] · ${details}`, fitted.diagnostics);
      throw new Error(`固定卡片内容预算超限：${details}`);
    }
    log(input.onLog, "response", `CardPlan 布局完成 · cards=${fitted.diagnostics.originalCardCount}→${fitted.diagnostics.finalCardCount} · split=${fitted.diagnostics.splitCards.length}`, fitted.diagnostics);
    const plan = fitted.plan;
    const resourceLinkCount = plan.cards.flatMap((card) => card.actions ?? []).filter((action) => action.type === "external-link" && !!action.link).length;
    base = { name: input.name, reasoning: envelope.outerReasoning ?? plan.reasoning, outputs: { cardCount: plan.cards.length, webFactCount: input.inferenceState.webFacts?.length ?? 0, resourceLinkCount, cardPlanResponseDiagnostics: envelope.diagnostics, mediaPlanningDiagnostics: mediaPlanning.diagnostics, layoutPlanningDiagnostics: fitted.diagnostics }, cardPlan: plan, cardPlanMarkdown: cardPlanToVibeMarkdown(plan), reasoningGraph: graphFromPlan(plan, input.inferenceState.slots), result: { summary: plan.skillName, assumptions: input.inferenceState.assumptions } };
  } else if (input.name === "openui_generate") {
    if (!input.cardPlan) throw new Error("缺少 card_plan_generate 的 CardPlan");
    const layoutMode = normalizeCardLayoutMode(input.layoutMode ?? input.cardPlan.layoutPolicy?.mode);
    const cardPlan = withCardLayoutPolicy(input.cardPlan, layoutMode);
    const promptRoute = openUISystemPromptFor({ taskFamily: classification.taskFamily, modelProfile: input.modelProfile ?? DEFAULT_PROFILES.openui_generate, layoutMode });
    const assetResolution = FEATURE_FLAGS.OPENUI_ASSETS
      ? await resolveAssetManifest(cardPlan)
      : disabledAssetResolution(cardPlan);
    const { manifest: assetManifest, diagnostics: rawAssetResolutionDiagnostics } = assetResolution;
    let assetResolutionDiagnostics: AssetResolutionDiagnostics = {
      ...rawAssetResolutionDiagnostics,
      synthesized: Math.max(0, Math.min(2, Math.round(input.mediaPlanningDiagnostics?.synthesized ?? 0))),
    };
    log(input.onLog, "response", `Host-owned media: ${assetResolutionDiagnostics.providerState} · ${assetResolutionDiagnostics.accepted}/${assetResolutionDiagnostics.candidates} accepted`, assetResolutionDiagnostics);
    const generationPayload = buildOpenUIGenerationPayload(cardPlan, assetManifest);
    const layoutPrompt = fixedOpenUILayoutPrompt(layoutMode);
    llm = await callText({
      ...selectedModel,
      ...sampling,
      ...steering,
      onLog: input.onLog,
      stream: input.stream,
      onStreamDelta: input.onStreamDelta,
      system: layoutPrompt ? `${promptRoute.prompt}\n\n${layoutPrompt}` : promptRoute.prompt,
      user: generationPayload,
    });
    let openuiCode = normalizeOpenUIOutput(String(llm.value ?? ""));
    let validation = validateOpenUIArtifact(openuiCode, cardPlan, assetManifest, generationPayload.designBrief);
    let repaired = false;
    let repairMs: number | undefined;
    if (!validation.valid) {
      repaired = true;
      log(input.onLog, "fallback", `OpenUI parser/覆盖校验失败，使用当前 provider 的非 Thinking 模型定向修复一次`, {
        errors: validation.errors,
        coverage: validation.coverage,
      });
      const repair = await callText({
        provider: selectedModel.provider,
        model: selectedModel.provider === "groq"
          ? "qwen/qwen3.6-27b"
          : selectedModel.provider === "hf_community"
            ? "Qwen/Qwen3.8-27B"
            : selectedModel.provider === "nvidia"
              ? NVIDIA_DIFFUSION_GEMMA_MODEL
              : "glm-5.2",
        thinking: false,
        temperature: 0,
        doSample: false,
        steeringHint: input.adaptiveContext?.stepHint,
        onLog: input.onLog,
        system: `${promptRoute.prompt}${layoutPrompt ? `\n\n${layoutPrompt}` : ""}\n\nYou are repairing an existing OpenUI program. Return the full corrected program, not a patch. Fix every supplied validation error while preserving valid visual structure. If validation reports DESIGN_META_LEAK, remove authoring/design metadata from visible UI. If missingAssets is present, use only its allowedAssetRefs in its target cardId, satisfy requiredCount, and follow its role/aspect placement guidance. If layoutViolations is present, simplify only those target cards until they fit the fixed canvas; replace risky components with compact semantic equivalents and do not remove required facts or actions. Preserve user-facing facts, labels, valid actions, and valid asset references.`,
        user: buildOpenUIRepairPayload(cardPlan, openuiCode, validation),
      });
      repairMs = repair.llmMs;
      const first = llm;
      llm = {
        ...repair,
        model: `${first.model} → ${repair.model}`,
        llmMs: first.llmMs + repair.llmMs,
        usage: addUsage(first.usage, repair.usage),
        cost: (first.cost ?? 0) + (repair.cost ?? 0),
        timeToFirstContentMs: first.timeToFirstContentMs,
        timeToFirstModelStatementMs: first.timeToFirstModelStatementMs,
      };
      openuiCode = normalizeOpenUIOutput(String(repair.value ?? ""));
      validation = validateOpenUIArtifact(openuiCode, cardPlan, assetManifest, generationPayload.designBrief);
      if (!validation.valid) {
        throw new Error(`OpenUI 两次均不可编译：${validation.errors.join("；")}`);
      }
    }
    const quality = analyzeOpenUIQuality(openuiCode, cardPlan, assetManifest);
    const plannedCards = cardPlan.cards.map(estimateCardLayout);
    const layoutStabilization = {
      status: "idle" as const,
      planned: { withinBudget: plannedCards.filter((card) => card.fits).length, total: plannedCards.length },
      static: { withinBudget: validation.layoutCoverage.withinBudget, total: validation.layoutCoverage.checkedCards },
      measured: { withinBudget: 0, total: 0 },
      measurements: [], overflowCardIds: [], repairAttempted: false, repairSucceeded: false,
      fallbackCardIds: [], stable: layoutMode === "free",
    };
    assetResolutionDiagnostics = {
      ...assetResolutionDiagnostics,
      required: validation.assetCoverage.required,
      used: validation.assetCoverage.matched,
      repaired,
    };
    base = {
      name: input.name,
      reasoning: repaired ? "OpenUI 初稿经 parser 与 CardPlan 覆盖校验后完成一次定向修复" : "模型直接生成了可编译且完整覆盖 CardPlan 的 OpenUI Lang",
      outputs: {
        protocol: "OpenUI Lang v0.5",
        userPayloadChars: JSON.stringify(generationPayload).length,
        statements: validation.parser.statements,
        coverage: validation.coverage,
        assetCoverage: validation.assetCoverage,
        layoutCoverage: validation.layoutCoverage,
        layout: layoutStabilization,
        repaired,
        repairTriggered: repaired,
        repairMs,
        quality,
        promptProfile: promptRoute.promptProfile,
        assetResolutionDiagnostics,
      },
      openuiCode,
      cardPlanMarkdown: cardPlanToVibeMarkdown(cardPlan, assetManifest, assetResolutionDiagnostics),
      assetManifest,
      assetResolutionDiagnostics,
      openuiDiagnostics: {
        coverage: validation.coverage,
        assetCoverage: validation.assetCoverage,
        layoutCoverage: validation.layoutCoverage,
        layout: layoutStabilization,
        parser: validation.parser,
        repaired,
        repairTriggered: repaired,
        repairMs,
        quality,
        promptProfile: promptRoute.promptProfile,
        assetManifest,
        assetResolutionDiagnostics,
      },
    };
  } else {
    throw new Error(`不支持的管线步骤: ${input.name}`);
  }

  const totalMs = Math.max(1, Date.now() - started);
  const timing = {
    totalMs,
    llmMs: llm.llmMs,
    overheadMs: Math.max(0, totalMs - llm.llmMs),
    providerCreatedAt: llm.providerCreatedAt,
    timeToFirstContentMs: llm.timeToFirstContentMs,
    timeToFirstModelStatementMs: llm.timeToFirstModelStatementMs,
  };
  const skillReuse: PipelineStepOutput["skillReuse"] = input.skillContext ? {
    skillId: input.skillContext.selection.skillId,
    skillVersionId: input.skillContext.selection.skillVersionId,
    recipeFingerprint: input.skillContext.selection.recipeFingerprint,
    score: input.skillContext.selection.score,
    activation: input.skillContext.selection.activation,
    matcherVersion: input.skillContext.selection.matcherVersion,
    matcherModel: input.skillContext.selection.matcherModel,
    executionMode: skillExecutionMode,
    callsAvoided: skillCallsAvoided,
    fallbackReason: skillFallbackReason,
    reuseTier: input.skillContext.reuseTier,
    executionStrategy: input.skillContext.executionStrategy,
    profileSimilarity: input.skillContext.profileSimilarity,
    ...describeSkillReuseEffect(input.name, input.skillContext, skillExecutionMode, skillCallsAvoided, skillFallbackReason, llm.model !== "skipped"),
  } : undefined;
  const provenance = summarizeStepForProvenance(input.name, {
    classification,
    adaptiveContext: input.adaptiveContext,
    profileView,
    inputState: input.inferenceState,
    output: { ...base, skillReuse },
    retrievedEvidence: retrievedEvidenceForProvenance,
    cardPlan: base.cardPlan ?? input.cardPlan,
    cardPlanMarkdown: base.cardPlanMarkdown,
    openuiCode: base.openuiCode,
  });
  return {
    ...base,
    adaptive: input.adaptiveContext ? {
      policyId: input.adaptiveContext.policyId,
      policyVersion: input.adaptiveContext.policyVersion,
      classification,
      steeringHint: input.adaptiveContext.stepHint,
    } : undefined,
    skillReuse,
    provenance,
    model: llm.model,
    modelProfile: input.modelProfile ?? DEFAULT_PROFILES[input.name],
    usage: llm.usage,
    cost: llm.cost,
    durationMs: totalMs,
    timing,
  };
}

/* ------------------------------------------------------------------ */
/*  暂停期投机搜索                                                      */
/*  ③ 完成暂停等用户答题时，后台提前执行 ④ 的联网搜索。                  */
/*  buildTaskSearchQuery 只取置信度>=0.7 的槽位；用户答案若改变最终检索词， */
/*  ④ 会拒绝预取并安全回退到即时搜索。                                  */
/* ------------------------------------------------------------------ */

export interface SearchPrefetchResult {
  searchQuery: string;
  shouldSearch: boolean;
  webSearchRaw: unknown;
  model?: string;
  llmMs?: number;
  usage?: TokenUsage;
  cost?: number;
  durationMs: number;
  mock?: boolean;
}

export async function runSearchPrefetch(args: {
  query: string;
  inferenceState: InferenceState;
  mock?: boolean;
  onLog?: (entry: CallLog) => void;
}): Promise<SearchPrefetchResult> {
  const started = Date.now();
  const base = refineFulfillment(args.inferenceState, args.query);
  const searchQuery = buildTaskSearchQuery(base);
  const shouldSearch = !!base.fulfillment?.requiresFreshData || base.fulfillment?.outcome !== "ideas";
  if (!shouldSearch) {
    return { searchQuery, shouldSearch: false, webSearchRaw: null, durationMs: Math.max(1, Date.now() - started) };
  }
  if (args.mock || !hasAnyLLMKey()) {
    return { searchQuery, shouldSearch: true, webSearchRaw: null, durationMs: Math.max(1, Date.now() - started), mock: true };
  }
  log(args.onLog, "request", `预取搜索 POST /chat/completions tool=web_search query="${searchQuery.slice(0, 60)}"`);
  const llm = await callJson({
    provider: process.env.GROQ_API_KEY ? "groq" : "glm",
    model: process.env.GROQ_API_KEY ? (process.env.GROQ_MODEL ?? "qwen/qwen3.6-27b") : "glm-5.2",
    thinking: false, temperature: 0.2, doSample: true,
    webSearchQuery: searchQuery,
    onLog: args.onLog,
    system: "你负责执行一次任务型联网搜索。只围绕给定检索词整理可用来源，不做方案总结，不回答用户问题。",
    user: { query: args.query, searchQuery },
    schemaHint: "{reasoning:string,note:string}",
  });
  return {
    searchQuery,
    shouldSearch: true,
    webSearchRaw: llm.webSearch ?? null,
    model: llm.model,
    llmMs: llm.llmMs,
    usage: llm.usage,
    cost: llm.cost,
    durationMs: Math.max(1, Date.now() - started),
  };
}
