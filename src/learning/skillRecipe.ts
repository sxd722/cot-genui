import { z } from "zod";
import { DECISION_MODES, TASK_FAMILIES } from "../lib/adaptive/types";
import { PIPELINE_STEPS, type PipelineStepName } from "../lib/pipelineTypes";
import type {
  SkillRecipe,
  SkillRecipeV1,
  SkillRecipeV2,
  SkillRecipeV3,
  SkillInvocation,
  SkillReuseSelection,
  SkillStepContext,
  StoredSkillRecipe,
} from "./workflowTypes";
import { parameterKindForKey } from "./queryAbstraction";

const MAX_TEXT = 240;
const FORBIDDEN_TEXT = /(?:https?:\/\/|data:|javascript:|file:\/\/|api[_ -]?key|authorization|cookie|secret|token|devicecontext|profileview|ignore\s+(?:all|previous)|system\s+prompt|developer\s+message|tool\s*call|<script|\beval\s*\(|\brequire\s*\()/i;

const safeText = z.string().trim().min(1).max(MAX_TEXT).refine((value) => !FORBIDDEN_TEXT.test(value), "包含 URL、私有字段或指令注入内容");
const shortText = z.string().trim().min(1).max(100).refine((value) => !FORBIDDEN_TEXT.test(value), "包含不安全内容");
const stringList = (max = 24) => z.array(shortText).max(max);

const slotRequirementSchema = z.object({
  key: shortText,
  label: shortText.optional(),
  description: safeText.optional(),
  required: z.boolean(),
  blocking: z.boolean(),
  weight: z.number().min(0).max(10).optional(),
  options: z.array(shortText).min(2).max(4).optional(),
}).strict();

export const skillRecipeV2Schema = z.object({
  formatVersion: z.literal("genui-skill-recipe/2"),
  intentContract: z.object({
    taskFamilies: z.array(z.enum(TASK_FAMILIES)).min(1).max(5),
    decisionModes: z.array(z.enum(DECISION_MODES)).min(1).max(5),
    taskType: shortText,
    fulfillment: z.object({
      outcome: z.enum(["ideas", "verified_recommendations", "actionable"]),
      requiresFreshData: z.boolean(),
      requiresLocation: z.boolean(),
      requiresActionLink: z.boolean(),
    }).strict(),
    queryVariables: stringList(),
    slotRequirements: z.array(slotRequirementSchema).max(40),
  }).strict(),
  profileBindings: z.array(z.object({
    key: shortText,
    slotKeys: stringList(),
    domains: stringList(),
    semanticQuery: safeText,
    required: z.boolean(),
    maxItems: z.number().int().min(1).max(20),
    runtimeOnly: z.literal(true),
  }).strict()).max(20),
  pipeline: z.object({
    protocol: z.literal("six-step-v1"),
    steps: z.array(z.object({
      step: z.enum(PIPELINE_STEPS),
      hint: safeText.optional(),
      requiredInputs: stringList(12),
      outputSchemaVersion: z.number().int().min(1).max(10),
      reuseStrategy: z.enum(["guide", "deterministic-eligible"]),
    }).strict()).max(6),
  }).strict(),
  clarificationPolicy: z.array(z.object({
    slotKeys: stringList(8),
    condition: safeText,
    questionTemplate: safeText,
    reason: safeText,
    options: z.array(shortText).min(2).max(4),
    blocking: z.boolean(),
  }).strict()).max(20),
  enrichmentPolicy: z.object({
    outcome: z.enum(["ideas", "verified_recommendations", "actionable"]),
    requiresFreshData: z.boolean(),
    capabilities: stringList(12),
  }).strict(),
  cardPlanRecipe: z.object({
    topology: z.literal("adaptive-unbounded"),
    cardPatterns: z.array(z.object({
      archetype: z.enum(["standard", "hero", "editorial", "comparison", "timeline", "data", "action", "media"]),
      blockKinds: stringList(20),
      actionTypes: z.array(z.enum(["navigate", "select", "toggle", "external-link", "confirm", "copy", "save", "pick-file", "ocr", "llm-call", "tool"])).max(12),
      assetRoles: stringList(8),
    }).strict()).max(30),
    actionPolicy: stringList(20),
    assetPolicy: stringList(20),
    layoutPolicy: z.enum(["fixed-600x300", "free"]),
  }).strict(),
  openuiRecipe: z.object({
    preferredPatterns: stringList(20),
    componentPreferences: stringList(30),
    mediaPlacementRules: stringList(12),
    validationProfile: shortText,
  }).strict(),
  acceptance: z.object({ validators: stringList(20), qualitySignals: stringList(20) }).strict(),
}).strict();

const parameterKindSchema = z.enum(["location", "date", "number", "enum", "entity", "text"]);
const intentTemplateSchema = z.object({
  intentKey: z.string().trim().regex(/^[a-z][a-z0-9_]{2,63}$/),
  displayName: shortText,
  invariantSummary: safeText,
  invariantTerms: stringList(20),
  parameters: z.array(z.object({
    key: shortText,
    label: shortText.optional(),
    valueKind: parameterKindSchema,
    required: z.boolean(),
    bindingSources: z.array(z.enum(["query", "profile", "clarification"])).min(1).max(3),
  }).strict()).max(40),
}).strict();

export const skillRecipeV3Schema = skillRecipeV2Schema.extend({
  formatVersion: z.literal("genui-skill-recipe/3"),
  intentTemplate: intentTemplateSchema,
}).strict();

function cleanOptions(options: string[] | undefined): string[] | undefined {
  const values = [...new Set((options ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 4);
  return values.length >= 2 ? values : undefined;
}

function normalizeIntentKey(value: string): string {
  const normalized = value.toLocaleLowerCase().normalize("NFKC")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 63);
  return /^[a-z]/.test(normalized) && normalized.length >= 3 ? normalized : "general_task";
}

function templateFromV2(recipe: SkillRecipeV2) {
  const requirementByKey = new Map(recipe.intentContract.slotRequirements.map((slot) => [slot.key, slot]));
  const keys = [...new Set([
    ...recipe.intentContract.queryVariables,
    ...recipe.intentContract.slotRequirements.map((slot) => slot.key),
  ])];
  return {
    intentKey: normalizeIntentKey(recipe.intentContract.taskType),
    displayName: recipe.intentContract.taskType,
    invariantSummary: `${recipe.intentContract.taskType}的可复用任务流程`,
    invariantTerms: [...new Set([
      recipe.intentContract.taskType,
      ...recipe.intentContract.taskFamilies,
      ...recipe.intentContract.decisionModes,
    ])].slice(0, 20),
    parameters: keys.map((key) => {
      const requirement = requirementByKey.get(key);
      return {
        key,
        label: requirement?.label,
        valueKind: parameterKindForKey(key),
        required: requirement?.required ?? recipe.intentContract.queryVariables.includes(key),
        bindingSources: ["query", "profile", "clarification"] as const,
      };
    }),
  };
}

function upgradeV1ToV2(recipe: SkillRecipeV1): SkillRecipeV2 {
  const legacy = recipe as SkillRecipeV1;
  const outcome = legacy.openuiRecipe.preferredPatterns.includes("action") ? "actionable" as const : "ideas" as const;
  const slotRequirements = legacy.intentContract.slotRequirements.map((slot) => ({
    key: slot.key,
    description: slot.description,
    required: slot.required,
    blocking: slot.required,
  }));
  return skillRecipeV2Schema.parse({
    formatVersion: "genui-skill-recipe/2",
    intentContract: {
      taskFamilies: legacy.intentContract.taskFamilies,
      decisionModes: legacy.intentContract.decisionModes,
      taskType: legacy.intentContract.taskFamilies[0] ?? "general",
      fulfillment: { outcome, requiresFreshData: false, requiresLocation: false, requiresActionLink: outcome === "actionable" },
      queryVariables: legacy.intentContract.queryVariables,
      slotRequirements,
    },
    profileBindings: legacy.profileBindings.map((binding) => ({ ...binding, slotKeys: [] })),
    pipeline: {
      protocol: "six-step-v1",
      steps: legacy.pipeline.steps.map((step) => ({
        ...step,
        hint: step.hint?.slice(0, MAX_TEXT),
        reuseStrategy: (["intent_analysis", "clarification", "context_enrichment"] as PipelineStepName[]).includes(step.step)
          ? "deterministic-eligible"
          : "guide",
      })),
    },
    clarificationPolicy: legacy.clarificationPolicy.map((policy) => ({
      ...policy,
      reason: "该槽位会影响任务结果",
      options: ["优先满足该项", "均衡考虑", "暂不限制"],
    })),
    enrichmentPolicy: { outcome, requiresFreshData: false, capabilities: [] },
    cardPlanRecipe: {
      topology: "adaptive-unbounded",
      cardPatterns: legacy.cardPlanRecipe.cardRoles.map((role) => {
        const [candidate, blocks = "summary"] = role.split(":", 2);
        const archetype = ["standard", "hero", "editorial", "comparison", "timeline", "data", "action", "media"].includes(candidate)
          ? candidate
          : "standard";
        return { archetype, blockKinds: blocks.split("+").filter(Boolean), actionTypes: [], assetRoles: [] };
      }),
      actionPolicy: legacy.cardPlanRecipe.actionPolicy,
      assetPolicy: legacy.cardPlanRecipe.assetPolicy,
      layoutPolicy: legacy.cardPlanRecipe.layoutPolicy,
    },
    openuiRecipe: legacy.openuiRecipe,
    acceptance: legacy.acceptance,
  });
}

export function upgradeSkillRecipe(recipe: StoredSkillRecipe): SkillRecipeV3 {
  if (recipe.formatVersion === "genui-skill-recipe/3") return skillRecipeV3Schema.parse(recipe);
  const v2 = recipe.formatVersion === "genui-skill-recipe/2"
    ? skillRecipeV2Schema.parse(recipe)
    : upgradeV1ToV2(recipe);
  return skillRecipeV3Schema.parse({
    ...v2,
    formatVersion: "genui-skill-recipe/3",
    intentTemplate: templateFromV2(v2),
  });
}

export function validateSkillRecipe(recipe: unknown): SkillRecipe {
  if (!recipe || typeof recipe !== "object") throw new Error("Skill recipe 必须是对象");
  const version = (recipe as { formatVersion?: string }).formatVersion;
  if (!["genui-skill-recipe/1", "genui-skill-recipe/2", "genui-skill-recipe/3"].includes(String(version))) {
    throw new Error(`不支持的 Skill recipe 版本：${String(version ?? "missing")}`);
  }
  return upgradeSkillRecipe(recipe as StoredSkillRecipe);
}

function pipelineHint(recipe: SkillRecipe, step: PipelineStepName): string | undefined {
  return recipe.pipeline.steps.find((item) => item.step === step)?.hint;
}

export function buildSkillStepContext(
  recipeInput: StoredSkillRecipe,
  selection: SkillReuseSelection,
  step: PipelineStepName,
  invocation?: SkillInvocation,
): SkillStepContext {
  const recipe = upgradeSkillRecipe(recipeInput);
  const common = { hint: pipelineHint(recipe, step) };
  let projection: Record<string, unknown>;
  let mode: SkillStepContext["mode"] = "guided";
  switch (step) {
    case "intent_analysis":
      mode = invocation?.deterministicIntentEligible === false ? "guided" : "deterministic";
      projection = {
        ...common,
        intentTemplate: recipe.intentTemplate,
        intentContract: recipe.intentContract,
        profileBindings: recipe.profileBindings,
        ...(invocation ? { runtimeInvocation: invocation } : {}),
      };
      break;
    case "evidence_resolution":
      projection = { ...common, profileBindings: recipe.profileBindings, slotKeys: recipe.intentContract.slotRequirements.map((slot) => slot.key) };
      break;
    case "clarification":
      mode = "deterministic";
      projection = { ...common, clarificationPolicy: recipe.clarificationPolicy };
      break;
    case "context_enrichment":
      mode = "deterministic";
      projection = { ...common, enrichmentPolicy: recipe.enrichmentPolicy };
      break;
    case "card_plan_generate":
      projection = { ...common, cardPlanRecipe: recipe.cardPlanRecipe };
      break;
    case "openui_generate":
      projection = { ...common, openuiRecipe: recipe.openuiRecipe };
      break;
  }
  return { formatVersion: "genui-skill-step/1", step, mode, selection, projection };
}

export function normalizeClarificationOptions(options: string[] | undefined): string[] | undefined {
  return cleanOptions(options);
}
