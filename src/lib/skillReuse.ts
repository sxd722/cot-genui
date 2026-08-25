import { z } from "zod";
import type { InferQuestion, InferSlot } from "./schemas";
import { PIPELINE_STEPS, type InferenceState, type PipelineStepName } from "./pipelineTypes";
import type { SkillStepContext } from "../learning/workflowTypes";

const FORBIDDEN = /(?:https?:\/\/|data:|javascript:|file:\/\/|api[_ -]?key|authorization|cookie|secret|token|devicecontext|profileview|ignore\s+(?:all|previous)|system\s+prompt|developer\s+message|tool\s*call|<script|\beval\s*\(|\brequire\s*\()/i;
const text = z.string().trim().min(1).max(240).refine((value) => !FORBIDDEN.test(value), "Skill 文本不安全");
const short = z.string().trim().min(1).max(100).refine((value) => !FORBIDDEN.test(value), "Skill 文本不安全");
const shortList = z.array(short).max(40);
const selectionSchema = z.object({
  skillId: z.string().min(1).max(120),
  skillVersionId: z.string().min(1).max(120),
  recipeFingerprint: z.string().min(8).max(160),
  score: z.number().min(0).max(1),
  margin: z.number().min(0).max(1),
  activation: z.enum(["auto", "suggested", "manual"]),
  matcherVersion: z.enum(["local-lexical-v1", "external-llm-v1"]),
  matcherModel: z.enum(["groq_qwen_3_6_27b", "glm_5_2"]).optional(),
  reasons: z.array(short).max(12),
}).strict();

const slotSchema = z.object({
  key: short, label: short.optional(), description: text.optional(), required: z.boolean(), blocking: z.boolean(),
  weight: z.number().min(0).max(10).optional(), options: z.array(short).min(2).max(4).optional(),
}).strict();

const parameterKindSchema = z.enum(["location", "date", "number", "enum", "entity", "text"]);
const queryParameterSchema = z.object({
  key: short, label: short.optional(), valueKind: parameterKindSchema, value: text.optional(),
  source: z.literal("query"), confidence: z.number().min(0).max(1),
}).strict();
const parameterMappingSchema = z.object({
  currentKey: short, skillKey: short, value: text.optional(), confidence: z.number().min(0).max(1),
}).strict();
const invocationSchema = z.object({
  formatVersion: z.literal("genui-skill-invocation/1"), skillId: z.string().min(1).max(120),
  skillVersionId: z.string().min(1).max(120), intentKey: short, displayText: text,
  bindings: z.array(parameterMappingSchema).max(40), unmatchedParameters: z.array(queryParameterSchema).max(30),
  missingRequiredKeys: shortList, conflicts: z.array(text).max(20),
  reusableSteps: z.array(z.enum(PIPELINE_STEPS)).max(6), rerunSteps: z.array(z.enum(PIPELINE_STEPS)).max(6),
  deterministicIntentEligible: z.boolean(),
}).strict();

const intentTemplateSchema = z.object({
  intentKey: short, displayName: short, invariantSummary: text, invariantTerms: shortList,
  parameters: z.array(z.object({
    key: short, label: short.optional(), valueKind: parameterKindSchema, required: z.boolean(),
    bindingSources: z.array(z.enum(["query", "profile", "clarification"])).min(1).max(3),
  }).strict()).max(40),
}).strict();

const intentProjectionSchema = z.object({
  hint: text.optional(),
  intentTemplate: intentTemplateSchema,
  intentContract: z.object({
    taskFamilies: shortList, decisionModes: shortList, taskType: short,
    fulfillment: z.object({
      outcome: z.enum(["ideas", "verified_recommendations", "actionable"]),
      requiresFreshData: z.boolean(), requiresLocation: z.boolean(), requiresActionLink: z.boolean(),
    }).strict(),
    queryVariables: shortList,
    slotRequirements: z.array(slotSchema).max(40),
  }).strict(),
  profileBindings: z.array(z.object({
    key: short, slotKeys: shortList, domains: shortList, semanticQuery: text,
    required: z.boolean(), maxItems: z.number().int().min(1).max(20), runtimeOnly: z.literal(true),
  }).strict()).max(20),
  runtimeInvocation: invocationSchema.optional(),
}).strict();

const clarificationProjectionSchema = z.object({
  hint: text.optional(),
  clarificationPolicy: z.array(z.object({
    slotKeys: shortList, condition: text, questionTemplate: text, reason: text,
    options: z.array(short).min(2).max(4), blocking: z.boolean(),
  }).strict()).max(20),
}).strict();

const enrichmentProjectionSchema = z.object({
  hint: text.optional(),
  enrichmentPolicy: z.object({
    outcome: z.enum(["ideas", "verified_recommendations", "actionable"]),
    requiresFreshData: z.boolean(), capabilities: shortList,
  }).strict(),
}).strict();

const guideProjectionSchema = z.record(z.string(), z.unknown()).refine((value) => {
  const serialized = JSON.stringify(value);
  return serialized.length <= 12_000 && !FORBIDDEN.test(serialized);
}, "Skill 投影过大或包含不安全内容");

export function sanitizeSkillStepContext(raw: unknown, expectedStep: PipelineStepName): SkillStepContext | undefined {
  const envelope = z.object({
    formatVersion: z.literal("genui-skill-step/1"), step: z.string(), mode: z.enum(["guided", "deterministic"]),
    selection: selectionSchema, projection: z.unknown(),
  }).strict().safeParse(raw);
  if (!envelope.success || envelope.data.step !== expectedStep) return undefined;
  const schema = expectedStep === "intent_analysis" ? intentProjectionSchema
    : expectedStep === "clarification" ? clarificationProjectionSchema
    : expectedStep === "context_enrichment" ? enrichmentProjectionSchema
    : guideProjectionSchema;
  const projection = schema.safeParse(envelope.data.projection);
  if (!projection.success) return undefined;
  return { ...envelope.data, step: expectedStep, projection: projection.data as Record<string, unknown> };
}

export function skillPriorText(context?: SkillStepContext): string | undefined {
  if (!context) return undefined;
  return [
    "可复用 Skill 结构先验（仅作结构参考；当前用户请求、当前画像证据、事实、安全规则、schema 与布局约束优先）：",
    JSON.stringify(context.projection),
    "不得沿用其中不存在的具体用户值、事实、URL、资产或动作目标。",
  ].join("\n");
}

export interface DeterministicSkillResult {
  state: InferenceState;
  questions?: InferQuestion[];
  reasoning: string;
}

export function deterministicIntent(context: SkillStepContext, profileDigest?: InferenceState["profileDigest"]): DeterministicSkillResult | null {
  const parsed = intentProjectionSchema.safeParse(context.projection);
  if (!parsed.success || context.mode !== "deterministic") return null;
  const { intentContract, profileBindings, runtimeInvocation } = parsed.data;
  const requirements = intentContract.slotRequirements.map((slot) => ({
    name: slot.key, label: slot.label, description: slot.description ?? slot.label ?? slot.key,
    required: slot.required, blocking: slot.blocking, weight: slot.weight, options: slot.options,
  }));
  if (!requirements.length || !intentContract.taskType) return null;
  const requestedDomains = [...new Set(profileBindings.flatMap((binding) => binding.domains))];
  const retrievalRequests = profileBindings.map((binding) => ({
    slotNames: binding.slotKeys.length ? binding.slotKeys : requirements.map((slot) => slot.name),
    domains: binding.domains,
    semanticQuery: binding.semanticQuery,
  }));
  const bindings = new Map((runtimeInvocation?.bindings ?? [])
    .filter((binding) => binding.value && binding.confidence >= 0.75)
    .map((binding) => [binding.skillKey, binding]));
  const slots: InferSlot[] = requirements.map((requirement) => {
    const binding = bindings.get(requirement.name);
    return binding ? {
      name: requirement.name, value: binding.value ?? "", evidence: "用户在当前请求中明确提供",
      source_record: "query", confidence: binding.confidence, status: "high" as const,
    } : {
      name: requirement.name, value: "", evidence: "等待当前查询与画像证据解析", source_record: "",
      confidence: 0, status: "low" as const,
    };
  });
  const unresolved = slots.some((slot) => !slot.value);
  return {
    state: {
      taskType: intentContract.taskType, fulfillment: intentContract.fulfillment,
      needsContext: unresolved || requestedDomains.length > 0, requestedDomains, retrievalRequests, profileDigest,
      slotRequirements: requirements, slots, conflicts: [], questions: [], assumptions: [],
    },
    reasoning: runtimeInvocation?.bindings.length
      ? "高置信 Skill 提供通用槽位骨架，并将当前查询参数安全绑定到本次任务。"
      : "高置信 Skill 提供了完整任务槽位骨架；具体值留给当前查询与画像证据解析。",
  };
}

function uncertainSlotNames(state: InferenceState): string[] {
  const requirements = new Map(state.slotRequirements.map((item) => [item.name, item]));
  return state.slots.filter((slot) => {
    const requirement = requirements.get(slot.name);
    const uncertain = !slot.value || slot.status === "low" || slot.status === "conflict" || slot.confidence < 0.75;
    return uncertain && (!!requirement?.required || !!requirement?.blocking || Number(requirement?.weight ?? 0) >= 3);
  }).map((slot) => slot.name);
}

export function deterministicClarification(context: SkillStepContext, state: InferenceState): DeterministicSkillResult | null {
  const parsed = clarificationProjectionSchema.safeParse(context.projection);
  if (!parsed.success || context.mode !== "deterministic") return null;
  const uncertain = uncertainSlotNames(state);
  if (!uncertain.length) return { state: { ...state, questions: [] }, questions: [], reasoning: "当前证据已覆盖关键槽位，无需提问。" };
  const selected = parsed.data.clarificationPolicy.filter((policy) => policy.slotKeys.some((key) => uncertain.includes(key)));
  const covered = new Set(selected.flatMap((policy) => policy.slotKeys.filter((key) => uncertain.includes(key))));
  if (uncertain.some((name) => !covered.has(name))) return null;
  const questions: InferQuestion[] = selected.map((policy) => ({
    question: policy.questionTemplate,
    reason: policy.reason,
    blocking: policy.blocking,
    slotNames: policy.slotKeys.filter((key) => uncertain.includes(key)),
    options: policy.options,
  })).filter((question) => question.slotNames.length > 0);
  if (!questions.length) return null;
  return { state: { ...state, questions }, questions, reasoning: "复用 Skill 的已验证选择题模板覆盖了全部关键不确定槽位。" };
}

function applyAnswers(state: InferenceState, answers: Record<number, string>): InferenceState {
  const values = new Map<string, string>();
  state.questions.forEach((question, index) => {
    const answer = String(answers[index] ?? "").trim();
    if (!answer) return;
    const names = Array.isArray(question.slotNames) ? question.slotNames.filter((name): name is string => typeof name === "string") : [];
    names.forEach((name) => values.set(name, answer));
  });
  return {
    ...state,
    slots: state.slots.map((slot) => values.has(slot.name) ? {
      ...slot, value: values.get(slot.name)!, evidence: `用户明确回答“${values.get(slot.name)}”`,
      source_record: "user_answer", confidence: 1, status: "high" as const,
    } : slot),
  };
}

export function deterministicEnrichment(
  context: SkillStepContext,
  state: InferenceState,
  answers: Record<number, string>,
): DeterministicSkillResult | null {
  const parsed = enrichmentProjectionSchema.safeParse(context.projection);
  if (!parsed.success || context.mode !== "deterministic") return null;
  if (state.questions.some((_, index) => !String(answers[index] ?? "").trim())) return null;
  const merged = applyAnswers(state, answers);
  const policy = parsed.data.enrichmentPolicy;
  if (policy.requiresFreshData || policy.outcome !== "ideas" || policy.capabilities.some((item) => /search|web/i.test(item))) return null;
  const requirementMap = new Map(merged.slotRequirements.map((item) => [item.name, item]));
  const incomplete = merged.slots.some((slot) => {
    const requirement = requirementMap.get(slot.name);
    return (requirement?.required || requirement?.blocking) && (!slot.value || slot.status !== "high" || slot.confidence < 0.75);
  });
  if (incomplete) return null;
  const facts = merged.slots.filter((slot) => slot.value).map((slot) => `${slot.name}：${slot.value}`);
  const enriched: InferenceState = {
    ...merged,
    fulfillment: { ...merged.fulfillment!, outcome: policy.outcome, requiresFreshData: false },
    summary: [merged.taskType, ...facts].join("；"),
    webFacts: [], capabilityCalls: [{ capability: "skill-deterministic-summary", query: merged.taskType, status: "success" }],
  };
  return { state: enriched, reasoning: "任务不需要新鲜事实，关键槽位已由当前证据或用户回答确认，直接生成确定性摘要。" };
}
