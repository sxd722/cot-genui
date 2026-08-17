import "server-only";

import OpenAI from "openai";
import { createLLMClient, extractJson, type CallLog } from "@/lib/llm";
import type { CardPlan } from "@/dsl/modules";
import type { InferConflict, InferQuestion, InferSlot } from "@/lib/schemas";
import { compileA2UIResponse, describeA2UIShape } from "@/lib/a2uiBlueprint";
import { retrieveProfileEvidence } from "@/lib/profile";
import type { ProfileDigest } from "@/lib/profileTypes";
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
  profileDigest?: ProfileDigest;
  modelProfile?: ModelProfile;
  mock?: boolean;
  onLog?: (entry: CallLog) => void;
}

interface LLMResult {
  value: unknown;
  model: string;
  llmMs: number;
  usage?: TokenUsage;
  providerCreatedAt?: number;
  cost?: number;
  webSearch?: unknown;
}

const DEFAULT_PROFILES: Record<PipelineStepName, ModelProfile> = {
  intent_analysis: "glm_4_7_flash",
  evidence_resolution: "glm_4_7_flash",
  clarification: "glm_5_2",
  context_enrichment: "glm_5_2",
  card_plan_generate: "glm_5_2_thinking",
  a2ui_generate: "glm_5_2_thinking",
};

const STEP_SAMPLING: Record<PipelineStepName, { temperature: number; doSample: boolean }> = {
  // 槽位定义需要覆盖用户没有明说、但会显著影响结果的维度，允许较强发散。
  intent_analysis: { temperature: 0.8, doSample: true },
  // 证据解析允许少量候选解释，但仍以引用事实和稳定置信度为主。
  evidence_resolution: { temperature: 0.35, doSample: true },
  clarification: { temperature: 0.25, doSample: true },
  context_enrichment: { temperature: 0.2, doSample: true },
  // 协议生成阶段优先结构稳定性。
  card_plan_generate: { temperature: 0, doSample: false },
  // 视觉规划与 CardPlan 一样需要一定创造性；结构正确性由覆盖校验和编译器兜底。
  a2ui_generate: { temperature: 0.4, doSample: true },
};

function resolveModel(profile: ModelProfile): { model: string; thinking: boolean } {
  switch (profile) {
    case "glm_5_2_thinking":
      return { model: "glm-5.2", thinking: true };
    case "glm_5_2":
      return { model: "glm-5.2", thinking: false };
    case "glm_4_7_flash":
      return { model: "glm-4.7-flash", thinking: false };
  }
}

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

async function callJson(args: {
  model: string;
  system: string;
  user: unknown;
  schemaHint: string;
  thinking: boolean;
  temperature: number;
  doSample: boolean;
  webSearchQuery?: string;
  onLog?: RunInput["onLog"];
  allowModelFallback?: boolean;
}): Promise<LLMResult> {
  const client = createLLMClient();
  const started = Date.now();
  const isGlm = args.model.toLowerCase().startsWith("glm-") ||
    (process.env.LLM_BASE_URL ?? "").toLowerCase().includes("bigmodel");
  log(args.onLog, "request", `POST /chat/completions model=${args.model} thinking=${args.thinking ? "enabled" : "disabled"} temperature=${args.temperature} do_sample=${args.doSample}${args.webSearchQuery ? " tool=web_search" : ""}`);

  const params = {
    model: args.model,
    messages: [
      { role: "system" as const, content: `${args.system}\n只返回合法 JSON。输出结构：${args.schemaHint}` },
      { role: "user" as const, content: JSON.stringify(args.user) },
    ],
    response_format: isGlm
      ? { type: "json_object" as const }
      : { type: "json_object" as const },
    temperature: args.temperature,
    ...(isGlm
      ? {
          thinking: { type: args.thinking ? "enabled" : "disabled" },
          do_sample: args.doSample,
          ...(args.thinking ? { reasoning_effort: "high" } : {}),
        }
      : {}),
    ...(args.webSearchQuery
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
  };

  try {
    const completion = await client.chat.completions.create(params);
    const llmMs = Date.now() - started;
    const usage = normalizeUsage(completion.usage);
    const content = completion.choices[0]?.message?.content ?? "";
    const value = extractJson(content);
    log(args.onLog, "response", `模型响应完成 ${llmMs}ms`, {
      model: completion.model,
      created: completion.created,
      usage: completion.usage,
      llmMs,
      responseShape: describeA2UIShape(value),
      webSearch: (completion as unknown as { web_search?: unknown }).web_search,
      note: "created 是响应时间戳，不是服务端推理耗时",
    });
    return {
      value,
      model: completion.model || args.model,
      llmMs,
      usage,
      providerCreatedAt: completion.created,
      cost: estimateCost(completion.model || args.model, usage),
      webSearch: (completion as unknown as { web_search?: unknown }).web_search,
    };
  } catch (error) {
    const llmMs = Date.now() - started;
    log(args.onLog, "error", `模型请求失败 ${llmMs}ms: ${error instanceof Error ? error.message : String(error)}`);
    const message = error instanceof Error ? error.message : String(error);
    if (args.model === "glm-4.7-flash" && args.allowModelFallback !== false && /429|访问量过大|rate.?limit/i.test(message)) {
      log(args.onLog, "fallback", "glm-4.7-flash 服务繁忙，自动改用 glm-5.2（thinking disabled）重试一次");
      return callJson({ ...args, model: "glm-5.2", thinking: false, allowModelFallback: false });
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

interface WebResource {
  query: string;
  summary: string;
  url?: string;
  score: number;
  actionKind?: "order" | "reserve" | "details";
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

function sourceScore(value: string): number {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    let score = url.pathname !== "/" || !!url.search ? 5 : 0;
    if (host.endsWith(".gov.cn") || host === "gov.cn") score += 5;
    if (host.endsWith("dpm.org.cn")) score += 8;
    if (/book|ticket|reserve|booking|预约|购票/i.test(`${url.pathname}${url.search}`)) score += 4;
    return score;
  } catch {
    return -1;
  }
}

function webResources(state: InferenceState): WebResource[] {
  return (state.webFacts ?? []).slice(0, 6).flatMap((fact, index) => {
    const entities = (fact.entities ?? []).flatMap((entity) => {
      const url = validHttpUrl(entity.actionUrl) ?? validHttpUrl(entity.sourceUrl);
      return entity.name && url ? [{
        query: entity.name,
        summary: entity.description,
        url,
        score: sourceScore(url) + (entity.actionUrl ? 6 : 0),
        actionKind: entity.actionUrl ? entity.actionKind : "details" as const,
      }] : [];
    });
    if (entities.length) return entities;
    const candidates = [...new Set((fact.sources ?? []).map(validHttpUrl).filter((url): url is string => !!url))]
      .map((url, sourceIndex) => ({ url, score: sourceScore(url), sourceIndex }))
      .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex);
    if (!candidates[0]?.url) return [];
    return [{
      query: String(fact.query || `公开信息 ${index + 1}`),
      summary: String(fact.summary || "已取得公开来源，详情请查看原始页面。"),
      url: candidates[0]?.url,
      score: candidates[0]?.score ?? -1,
      actionKind: "details" as const,
    }];
  });
}

function compactResourceLabel(query: string, actionKind?: WebResource["actionKind"]): string {
  const label = query.replace(/[\r\n]+/g, " ").trim();
  const verb = actionKind === "order" ? "去下单" : actionKind === "reserve" ? "去预订" : "查看";
  return `${verb}${label.slice(0, 18) || "公开来源"}`;
}

/**
 * 把联网总结确定性写入 CardPlan。模型即使漏抄 webFacts，公开事实和精确 URL 也不会
 * 在 CardPlan → DSL → A2UI 的链路中消失。
 */
export function integrateWebFactsIntoCardPlan(plan: CardPlan, state: InferenceState): CardPlan {
  const cards = plan.cards.map((card) => ({
    ...card,
    sourceSlots: card.sourceSlots ? [...card.sourceSlots] : undefined,
    blocks: [...card.blocks],
    actions: card.actions ? [...card.actions] : undefined,
  }));
  const existingText = JSON.stringify(cards.flatMap((card) => card.blocks));
  const existingLinks = new Set(
    cards.flatMap((card) => card.actions ?? [])
      .filter((action) => action.type === "external-link")
      .map((action) => validHttpUrl(action.link))
      .filter((url): url is string => !!url),
  );
  const resources = webResources(state)
    .map((item) => ({ ...item, url: item.url && existingLinks.has(item.url) ? undefined : item.url }))
    .filter((item) => !!item.url || !existingText.includes(item.summary));
  if (!resources.length) return plan;

  const availableCards = Math.max(0, 6 - cards.length);
  const chunks: WebResource[][] = [];
  if (availableCards > 0) {
    const chunkCount = Math.min(availableCards, Math.ceil(resources.length / 3), 2);
    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * Math.ceil(resources.length / chunkCount);
      const end = (index + 1) * Math.ceil(resources.length / chunkCount);
      chunks.push(resources.slice(start, end));
    }
  } else {
    chunks.push(resources);
  }

  chunks.filter((chunk) => chunk.length).forEach((chunk, chunkIndex) => {
    const rankedLinks = chunk.filter((item) => item.url).sort((left, right) => right.score - left.score).slice(0, 3);
    const blocks = chunk.length <= 5
      ? chunk.map((item) => ({
          kind: "summary" as const,
          title: item.query,
          text: item.summary,
          detail: item.url ? `来源：${new URL(item.url).hostname}` : undefined,
          sourceSlots: ["webFacts"],
        }))
      : [{
          kind: "list" as const,
          title: "最新公开信息",
          items: chunk.map((item) => ({ label: `${item.query}：${item.summary}` })),
          sourceSlots: ["webFacts"],
        }];
    const actions = rankedLinks.map((item, actionIndex) => ({
      id: `open_web_source_${chunkIndex + 1}_${actionIndex + 1}`,
      label: compactResourceLabel(item.query, item.actionKind),
      type: "external-link" as const,
      link: item.url,
      role: actionIndex === 0 ? "primary" as const : "secondary" as const,
    }));

    if (availableCards > 0) {
      cards.push({
        id: chunkIndex === 0 ? "official_resources" : `official_resources_${chunkIndex + 1}`,
        purpose: chunkIndex === 0 && resources.some((item) => item.actionKind === "order" || item.actionKind === "reserve") ? "真实推荐与可用入口" : chunkIndex === 0 ? "公开信息与来源入口" : "更多公开来源",
        sourceSlots: ["webFacts"],
        blocks,
        actions,
      });
    } else {
      const targetIndex = Math.max(0, cards.length - 1 - chunkIndex);
      const target = cards[targetIndex];
      if (!target) return;
      target.sourceSlots = [...new Set([...(target.sourceSlots ?? []), "webFacts"])];
      target.blocks = [...target.blocks, ...blocks];
      target.actions = [...(target.actions ?? []), ...actions];
    }
  });

  return { ...plan, cards };
}

function semanticFromPlan(plan: CardPlan): string {
  const lines = [`# ${plan.iconText ? `${plan.iconText} ` : ""}${plan.skillName}`, "", `> ${plan.reasoning}`];
  for (const card of plan.cards) {
    lines.push("", `## ${card.purpose}`);
    for (const block of card.blocks) {
      const title = block.title ? `**${block.title}**：` : "";
      const value = block.value ?? block.text ?? block.detail;
      if (value) lines.push(`- ${title}${value}`);
      for (const item of block.items ?? []) lines.push(`- ${item.label}`);
      for (const metric of block.metrics ?? []) lines.push(`- ${metric.label}：${metric.value}${metric.unit ?? ""}`);
    }
    for (const action of card.actions ?? []) {
      if (action.type === "external-link" && action.link) lines.push(`- [${action.label}](${action.link})`);
      else lines.push(`- 操作：${action.label}`);
    }
  }
  return lines.join("\n");
}

function graphFromPlan(plan: CardPlan, slots: InferSlot[]): string {
  const lines = ["flowchart LR"];
  const slotIds = new Map(slots.map((slot, index) => [slot.name, `S${index}`]));
  slots.forEach((slot, index) => lines.push(`  S${index}["${slot.name}=${String(slot.value).replaceAll('"', "'")}"]`));
  plan.cards.forEach((card, cardIndex) => {
    lines.push(`  C${cardIndex}["${card.purpose.replaceAll('"', "'")}"]`);
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

function validCardPlan(value: unknown): value is CardPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<CardPlan>;
  return typeof plan.skillName === "string" && typeof plan.reasoning === "string" && Array.isArray(plan.cards) && plan.cards.length > 0;
}

function normalizeCardPlan(plan: CardPlan, allowedExternalUrls: Set<string>): CardPlan {
  const validRoles = new Set(["primary", "secondary", "tertiary"]);
  return {
    ...plan,
    cards: plan.cards.slice(0, 6).map((card, cardIndex) => ({
      ...card,
      id: typeof card.id === "string" && card.id.trim() ? card.id : `card_${cardIndex + 1}`,
      blocks: (Array.isArray(card.blocks) ? card.blocks : []).map((block) => ({
        ...block,
        items: Array.isArray(block.items) ? block.items.map((item) => {
          const raw = item as unknown as { label?: unknown; title?: unknown; detail?: unknown; onSelect?: typeof item.onSelect };
          return {
            label: String(raw.label ?? raw.title ?? "未命名项目"),
            ...(raw.detail ? { detail: String(raw.detail) } : {}),
            ...(raw.onSelect ? { onSelect: raw.onSelect } : {}),
          };
        }) : undefined,
      })),
      actions: Array.isArray(card.actions) ? card.actions
        .filter((action) => action && typeof action.id === "string" && typeof action.label === "string")
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
  const plan: CardPlan = input.cardPlan ?? { skillName: input.query, iconText: "S", reasoning: "基于明确需求生成方案", cards: [{ id: "overview", purpose: "方案概览", sourceSlots: ["request"], blocks: [{ kind: "hero", title: input.query, text: "方案已生成", sourceSlots: ["request"] }] }] };
  const table: Record<PipelineStepName, Omit<PipelineStepOutput, "durationMs" | "timing" | "model">> = {
    intent_analysis: { name: input.name, reasoning: "识别任务及最小槽位（mock）", outputs: { taskType: state.taskType, needsContext: false }, inferenceState: state, slots: state.slots },
    evidence_resolution: { name: input.name, reasoning: "无需额外上下文（mock）", outputs: {}, inferenceState: input.inferenceState ?? state, slots: (input.inferenceState ?? state).slots, conflicts: [], questions: [] },
    clarification: { name: input.name, reasoning: "没有需要澄清的关键槽位（mock）", outputs: { questionCount: 0 }, inferenceState: input.inferenceState ?? state, slots: (input.inferenceState ?? state).slots, questions: [] },
    context_enrichment: { name: input.name, reasoning: "完成总结与能力补齐（mock）", outputs: { summary: "mock summary", capabilityCalls: [] }, inferenceState: { ...(input.inferenceState ?? state), summary: "mock summary", webFacts: [], capabilityCalls: [] }, slots: (input.inferenceState ?? state).slots },
    card_plan_generate: { name: input.name, reasoning: plan.reasoning, outputs: { cardCount: plan.cards.length }, cardPlan: plan, semanticMarkdown: semanticFromPlan(plan), reasoningGraph: graphFromPlan(plan, input.inferenceState?.slots ?? [slot]), result: { summary: plan.skillName, assumptions: input.inferenceState?.assumptions ?? [] } },
    a2ui_generate: { name: input.name, reasoning: "由模型生成 A2UI（mock）", outputs: {}, a2uiJsonl: [{ version: "v0.9", createSurface: { surfaceId: "mock" } }, { version: "v0.9", updateComponents: { surfaceId: "mock", components: [{ id: "root", component: "Card", child: "text" }, { id: "text", component: "Text", text: plan.skillName, variant: "h3" }] } }] },
  };
  return table[input.name];
}

export async function runPipelineStep(input: RunInput): Promise<PipelineStepOutput> {
  const started = Date.now();
  const selectedModel = resolveModel(input.modelProfile ?? DEFAULT_PROFILES[input.name]);
  const sampling = STEP_SAMPLING[input.name];
  if (input.mock) {
    const base = mockResult(input);
    const totalMs = Math.max(1, Date.now() - started);
    return { ...base, model: "mock", modelProfile: input.modelProfile ?? DEFAULT_PROFILES[input.name], durationMs: totalMs, timing: { totalMs, llmMs: 0, overheadMs: totalMs } };
  }

  let llm: LLMResult;
  let base: Omit<PipelineStepOutput, "durationMs" | "timing" | "model" | "usage" | "cost">;

  if (input.name === "intent_analysis") {
    llm = await callJson({
      ...selectedModel, ...sampling, onLog: input.onLog,
      system: "你负责根据用户请求和 query-independent 通用画像胶囊建立任务模型。taskType 必须是任务领域名称（如饮食推荐/职业决策/旅行规划），不能写 ideas/actionable；交付等级单独写 fulfillment。先判断用户最终要灵感、经验证的具体推荐，还是可执行动作；再从最终交付物反推所有会影响内容、排序、约束、个性化和外部检索的槽位。画像胶囊只用于发现可用领域和候选槽位，不可直接当作最终证据。必须输出 requestedDomains 和 retrievalRequests，让下一阶段按需回查原始记录。通常覆盖时间、地点、对象、预算、偏好、限制和交付方式；不要用固定槽位数量截断。对可能需要用户确认的槽位提供2-4个互斥 options。只把 query 明示内容写入 explicitValue。",
      user: { query: input.query, generalProfile: input.profileDigest },
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
    base = { name: input.name, reasoning: raw.reasoning ?? "完成任务建模与检索规划", outputs: { taskType: state.taskType, fulfillment: state.fulfillment, needsContext: state.needsContext, requestedDomains: state.requestedDomains, retrievalRequests: state.retrievalRequests, slotRequirements: requirements }, inferenceState: state, slots };
  } else if (input.name === "evidence_resolution") {
    if (!input.inferenceState) throw new Error("缺少 intent_analysis 的 inferenceState");
    if (!input.inferenceState.needsContext) {
      const state = { ...input.inferenceState, conflicts: [], questions: [] };
      llm = { value: {}, model: "skipped", llmMs: 0 };
      base = { name: input.name, reasoning: "必需信息已由用户明确提供，跳过设备上下文模型调用。", outputs: { skipped: true }, inferenceState: state, slots: state.slots, conflicts: [], questions: [] };
    } else {
      const retrievedEvidence = retrieveProfileEvidence(input.deviceContext, input.inferenceState.retrievalRequests ?? []);
      const requestedDomainSet = new Set((input.inferenceState.requestedDomains ?? []).map((domain) => domain.toLowerCase()));
      const domainSummaries = (input.inferenceState.profileDigest?.domains ?? []).filter((domain) => requestedDomainSet.has(domain.name.toLowerCase()));
      llm = await callJson({
        ...selectedModel, ...sampling, onLog: input.onLog,
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
        ...selectedModel, ...sampling, onLog: input.onLog,
        system: "你负责在生成方案前完成最小化澄清。只针对给定 uncertainSlotNames 提问；可以把高度相关槽位合并成一个问题，但 questions.slotNames 必须覆盖每个不确定槽位。所有问题都必须是选择题并提供2-4个简短、互斥、覆盖常见情况的 options，禁止填空题或省略 options；必要时加入“暂不限制/暂不确定”。不得把这些问题延迟到最终卡片或 A2UI。",
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
    llm = await callJson({
      ...selectedModel, ...sampling, webSearchQuery: shouldSearch ? searchQuery : undefined, onLog: input.onLog,
      system: "你负责在方案生成前汇总已确认事实，并在需要时用唯一一次联网搜索取得最终交付所需的具体实体和可用入口。用户回答已由代码写回 slots，不得覆盖。搜索必须围绕任务、时间、地点、预算、偏好、限制和 fulfillment；不要把普通任务改写成政策/注意事项查询。对于餐饮等本地推荐，应优先返回真实具体的商家或菜品。sources/sourceUrl/actionUrl 只能原样来自搜索工具结果，禁止拼接或猜测。只有明确的交易深链才标 order/reserve，否则 actionKind=details。无法取得有效实体时透明降级，不得虚构。",
      user: { currentDate: new Date().toISOString().slice(0, 10), query: input.query, inference: projectForModel(input.name, mergedState), confirmedAnswers: qa, publicSearchQuery: shouldSearch ? searchQuery : null, searchBudget: { used: shouldSearch ? 1 : 0, max: 1 } },
      schemaHint: "{reasoning:string,summary:string,slots:[{name,value,evidence,source_record,confidence,status}],assumptions:string[],webFacts:[{query:string,summary:string,sources?:string[],entities?:[{name:string,category?:string,description:string,locality?:string,sourceUrl:string,actionUrl?:string,actionKind:'order'|'reserve'|'details'}]}],capabilityCalls:[{capability:'web_search'|'llm_reasoning',query:string,status:'success'|'skipped'|'error'}]} ",
    });
    const raw = llm.value as { reasoning?: string; summary?: string; slots?: InferSlot[]; assumptions?: string[]; webFacts?: InferenceState["webFacts"]; capabilityCalls?: InferenceState["capabilityCalls"] };
    const providerSearchUrls = shouldSearch ? extractUrlsFromSearch(llm.webSearch) : [];
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
    base = { name: input.name, reasoning: raw.reasoning ?? "完成上下文总结与任务型能力补齐", outputs: { summary: state.summary, searchQuery: shouldSearch ? searchQuery : null, searchBudgetUsed: shouldSearch ? 1 : 0, verifiedEntityCount, actionableLinkCount, providerUrlCount: providerSearchUrls.length, webFacts: state.webFacts, capabilityCalls: state.capabilityCalls, providerSearchResults: llm.webSearch }, inferenceState: state, slots: state.slots, questions: state.questions };
  } else if (input.name === "card_plan_generate") {
    if (!input.inferenceState) throw new Error("缺少 evidence_resolution 的 inferenceState");
    if (!input.inferenceState.summary) throw new Error("请先完成不确定性提问和上下文能力补齐，再生成 CardPlan");
    llm = await callJson({
      ...selectedModel, ...sampling, onLog: input.onLog,
      system: "你是 CardPlan 规划器。基于已经过用户澄清、事实总结和能力补齐的推断状态生成可编译卡片计划。reasoning 控制在120字内；生成3-6张卡。block kind 只能是 hero/summary/list/progress/status/metric/choice/toggle/image/chart/infographic。list.items 每项必须使用 {label,detail?}，禁止使用 title 代替 label。每张卡/块用 sourceSlots 标记证据槽位。若 webFacts.entities 存在，必须把具体实体名称、推荐理由和 locality 放入业务推荐卡的列表，不可只生成泛化建议；可用 actionUrl/sourceUrl 原样复制为 external-link，order/reserve 才使用“下单/预订”文案，否则写“查看详情”。action role 只能是 primary/secondary/tertiary。不得把低置信槽位做成选项要求用户再次回答。不要生成 HTML、Markdown、A2UI 或 missingInfo。",
      user: { query: input.query, inference: projectForModel(input.name, input.inferenceState), answers: input.userAnswers ?? {} },
      schemaHint: "{reasoning:string,cardPlan:{skillName,iconText?,reasoning,cards:[{id,purpose,sourceSlots?,blocks:[{kind,title?,text?,detail?,tone?,value?,valueFromSlot?,items?:[{label:string,detail?:string}],itemsFromSlot?,options?,currentFromSlot?,metrics?,sourceSlots?}],actions?:[{id:string,label:string,type:'navigate'|'select'|'toggle'|'external-link'|'confirm'|'copy'|'save'|'pick-file'|'ocr'|'llm-call',targetCardId?,writeTo?,writeValue?,link?,role?:'primary'|'secondary'|'tertiary'}]}]}}",
    });
    const raw = llm.value as { reasoning?: string; cardPlan?: unknown };
    if (!validCardPlan(raw.cardPlan)) throw new Error("模型返回的 CardPlan 结构无效");
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
    // 集成 webFacts 时同样只保留 provider 可验证的实体/来源，避免"模型编造的实体链接"经确定性注入回流。
    const integrationState: InferenceState = useProviderRegistry
      ? {
          ...input.inferenceState,
          webFacts: (input.inferenceState.webFacts ?? []).map((fact) => ({
            ...fact,
            sources: (fact.sources ?? []).filter((source) => allowedExternalUrls.has(String(source).trim())),
            entities: (fact.entities ?? []).filter((entity) =>
              allowedExternalUrls.has(String(entity.sourceUrl ?? "").trim()) &&
              (!entity.actionUrl || allowedExternalUrls.has(String(entity.actionUrl).trim()))),
          })),
        }
      : input.inferenceState;
    const plan = integrateWebFactsIntoCardPlan(normalizeCardPlan(raw.cardPlan, allowedExternalUrls), integrationState);
    const resourceLinkCount = plan.cards.flatMap((card) => card.actions ?? []).filter((action) => action.type === "external-link" && !!action.link).length;
    base = { name: input.name, reasoning: raw.reasoning ?? plan.reasoning, outputs: { cardCount: plan.cards.length, webFactCount: input.inferenceState.webFacts?.length ?? 0, resourceLinkCount }, cardPlan: plan, semanticMarkdown: semanticFromPlan(plan), reasoningGraph: graphFromPlan(plan, input.inferenceState.slots), result: { summary: plan.skillName, assumptions: input.inferenceState.assumptions } };
  } else {
    if (!input.cardPlan) throw new Error("缺少 card_plan_generate 的 CardPlan");
    llm = await callJson({
      ...selectedModel, ...sampling, onLog: input.onLog,
      system: "你是 CardPlan 驱动的 A2UI 视觉规划器。必须为 CardPlan 的每张 card 生成且仅生成一个同 ID 的 surface，完整表达每个 block 和 action，不能把丰富内容压缩成几段普通 Text。每个 surface 写 sourceCardId、visualDirection、coveredBlockIndexes、coveredActionIds；coveredBlockIndexes 必须覆盖该卡所有 block 索引，coveredActionIds 必须覆盖所有 action.id。根据语义选择视觉方向 dashboard/timeline/checklist/comparison/hero。组件映射：hero/highlight→Hero；metric→Metric 或 Metric Row；progress→Progress；status→Badge/Hero；list→List、Timeline 或 Badge 组合；choice→ChoicePicker；toggle→CheckBox；summary→层级化 Text/Row。可用组件：Card,Column,Row,List,Text,Button,Divider,Icon,Image,CheckBox,Slider,ChoicePicker,Hero,Metric,Progress,Badge,Timeline。每个 CardPlan action 必须生成 Button/ChoicePicker：navigate 保留 goto，select/back 保留原事件；external-link 必须生成 Button，且 action 严格为 {functionCall:{call:'openUrl',args:{url: action.link 的原始精确值}}}，不得把外链改成 goto 或省略 URL。只生成嵌套组件对象，不生成组件 ID、扁平表或 JSONL。",
      user: { cardPlan: input.cardPlan },
      schemaHint: "{reasoning:string,a2uiBlueprint:{surfaces:[{id:string,sourceCardId:string,visualDirection:'dashboard'|'timeline'|'checklist'|'comparison'|'hero',coveredBlockIndexes:number[],coveredActionIds:string[],root:{component:'Card',tone?:string,children:[nested components]}}]}}；nested component 可含 component/text/title/subtitle/label/value/unit/tone/detail/items/options/variant/action/children；外链 Button.action={functionCall:{call:'openUrl',args:{url:string}}}",
    });
    let compiled;
    try {
      compiled = compileA2UIResponse(llm.value, input.cardPlan);
    } catch (firstError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      const repairModel = "glm-5.2";
      log(input.onLog, "fallback", `A2UI Blueprint 覆盖/结构校验失败，定向修复一次: ${firstMessage}`, {
        responseShape: describeA2UIShape(llm.value),
      });
      const repair = await callJson({
        model: repairModel, thinking: false, temperature: 0, doSample: false, onLog: input.onLog,
        system: "你负责修复 A2UI 视觉 Blueprint。保留上一版有价值的视觉设计，但必须补齐校验信息指出的 card/block/action。每个 CardPlan card 对应一个同 ID surface；填写 sourceCardId、visualDirection、完整 coveredBlockIndexes/coveredActionIds；root 为 Card，child/children 必须是内联组件对象。external-link 必须是 Button.action.functionCall，call=openUrl，args.url 原样等于 CardPlan action.link。不要输出扁平 JSONL 或组件 ID。",
        user: { cardPlan: input.cardPlan, previousOutput: llm.value, validationFailure: firstMessage },
        schemaHint: "{reasoning:string,a2uiBlueprint:{surfaces:[{id:string,sourceCardId:string,visualDirection:string,coveredBlockIndexes:number[],coveredActionIds:string[],root:{component:'Card',children:[nested components]}}]}}",
      });
      const fast = llm;
      llm = {
        ...repair,
        model: `${fast.model} → ${repair.model}`,
        llmMs: fast.llmMs + repair.llmMs,
        usage: addUsage(fast.usage, repair.usage),
        cost: (fast.cost ?? 0) + (repair.cost ?? 0),
      };
      try {
        compiled = compileA2UIResponse(repair.value, input.cardPlan);
      } catch (repairError) {
        throw new Error(`A2UI Blueprint 两次均不可编译：${repairError instanceof Error ? repairError.message : String(repairError)}`);
      }
    }
    const raw = llm.value as { reasoning?: string };
    const rawObject = llm.value && typeof llm.value === "object" ? llm.value as Record<string, unknown> : {};
    base = {
      name: input.name,
      reasoning: raw.reasoning ?? "完成 A2UI Blueprint 生成与确定性编译",
      outputs: { messageCount: compiled.messages.length, coverage: compiled.coverage, compileWarnings: compiled.warnings },
      a2uiBlueprint: rawObject.a2uiBlueprint ?? rawObject.blueprint ?? llm.value,
      a2uiJsonl: compiled.messages,
    };
  }

  const totalMs = Math.max(1, Date.now() - started);
  const timing = { totalMs, llmMs: llm.llmMs, overheadMs: Math.max(0, totalMs - llm.llmMs), providerCreatedAt: llm.providerCreatedAt };
  return { ...base, model: llm.model, modelProfile: input.modelProfile ?? DEFAULT_PROFILES[input.name], usage: llm.usage, cost: llm.cost, durationMs: totalMs, timing };
}
