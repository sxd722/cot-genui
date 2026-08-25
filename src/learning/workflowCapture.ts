import type { QueryClassification } from "../lib/adaptive/types";
import type { CardLayoutMode, CardPlan } from "../dsl/modules";
import type { InferenceState, ModelProfile, PipelineStepName, StepTiming, TokenUsage } from "../lib/pipelineTypes";
import type { StepProvenance } from "../lib/provenance";
import type { AssetManifest } from "../openui/assetTypes";
import type { GenerationEpisode } from "./types";
import { getLearningDatabase } from "./database";
import { byteSize, canonicalJson, createLearningId, sha256 } from "./hash";
import type {
  ArtifactKind,
  ArtifactRecord,
  SkillCandidateRecord,
  SkillExampleRecord,
  SkillIndexProfile,
  QueryAbstractionV1,
  SkillInvocation,
  SkillMatchReport,
  SkillRecipe,
  SkillReuseSelection,
  SkillStepReuseSettings,
  StepRunRecord,
  TaskRunRecord,
} from "./workflowTypes";
import { parameterKindForKey } from "./queryAbstraction";

const PIPELINE_VERSION = "six-step-v1";
const PROMPT_SET_HASH = "runtime-prompt-set";
const OPENUI_SPEC_HASH = "generated-openui-spec";
const FEATURE_FLAGS_HASH = "runtime-feature-flags";

function now() { return new Date().toISOString(); }
export function workflowRunId(episodeId: string) { return `run_${episodeId}`; }

function cleanPrivatePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanPrivatePayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => ![
      "deviceContext", "profileSourceText", "webSearchRaw", "providerSearchResults", "providerSearchUrls",
      "_logs", "logs", "reasoning", "raw", "rawResponse", "apiKey",
    ].includes(key))
    .map(([key, item]) => [key, cleanPrivatePayload(item)]));
}

function termsFromQuery(query: string): string[] {
  const terms = query.toLocaleLowerCase().match(/[\p{Script=Han}]{2,8}|[a-z0-9][a-z0-9_-]{2,}/gu) ?? [];
  return [...new Set(terms)].slice(0, 24);
}

async function artifactData(kind: ArtifactKind, payload: unknown, input: {
  runId?: string;
  stepRunId?: string;
  skillVersionId?: string;
  sensitivity?: ArtifactRecord["sensitivity"];
} = {}) {
  const normalizedPayload = cleanPrivatePayload(payload);
  const contentHash = await sha256(normalizedPayload);
  const artifact: ArtifactRecord = {
    id: createLearningId("artifact"),
    runId: input.runId,
    stepRunId: input.stepRunId,
    skillVersionId: input.skillVersionId,
    kind,
    schemaVersion: 1,
    contentHash,
    sensitivity: input.sensitivity ?? "private",
    redactionStatus: input.sensitivity === "shareable" || input.sensitivity === "sanitized" ? "redacted" : "not-required",
    createdAt: now(),
  };
  return {
    artifact,
    content: {
      contentHash,
      codec: typeof normalizedPayload === "string" ? "utf8" as const : "structured-clone" as const,
      byteSize: byteSize(normalizedPayload),
      payload: normalizedPayload,
    },
  };
}

export async function startTaskRun(input: {
  episodeId: string;
  query: string;
  classification: QueryClassification;
  layoutMode: CardLayoutMode;
  language?: string;
  skillSelection?: SkillReuseSelection;
  skillStepReuse?: SkillStepReuseSettings;
  queryAbstraction?: QueryAbstractionV1;
  skillMatchReport?: SkillMatchReport;
  skillInvocation?: SkillInvocation;
}): Promise<TaskRunRecord> {
  const database = getLearningDatabase();
  const id = workflowRunId(input.episodeId);
  const existing = await database.taskRuns.get(id);
  if (existing) return existing;
  const queryData = await artifactData("query", input.query.slice(0, 10_000), { runId: id });
  const privateDiagnostics = await Promise.all([
    input.queryAbstraction ? artifactData("query-abstraction", input.queryAbstraction, { runId: id }) : undefined,
    input.skillMatchReport ? artifactData("skill-match-report", input.skillMatchReport, { runId: id }) : undefined,
    input.skillInvocation ? artifactData("skill-invocation", input.skillInvocation, { runId: id }) : undefined,
  ]);
  const [abstractionData, matchReportData, invocationData] = privateDiagnostics;
  const timestamp = now();
  const run: TaskRunRecord = {
    id,
    schemaVersion: 2,
    status: "running",
    queryArtifactId: queryData.artifact.id,
    queryFingerprint: queryData.content.contentHash,
    taskFamily: input.classification.taskFamily,
    decisionMode: input.classification.decisionMode,
    language: input.language ?? "zh-CN",
    domains: [],
    intentTerms: termsFromQuery(input.query),
    slotNames: [],
    capabilities: [],
    layoutMode: input.layoutMode,
    pipelineVersion: PIPELINE_VERSION,
    promptSetHash: PROMPT_SET_HASH,
    openuiSpecHash: OPENUI_SPEC_HASH,
    featureFlagsHash: FEATURE_FLAGS_HASH,
    sourceSkillId: input.skillSelection?.skillId,
    sourceSkillVersionId: input.skillSelection?.skillVersionId,
    sourceSkillRecipeFingerprint: input.skillSelection?.recipeFingerprint,
    skillMatchScore: input.skillSelection?.score,
    skillMatchMargin: input.skillSelection?.margin,
    skillMatchActivation: input.skillSelection?.activation,
    skillMatcherVersion: input.skillSelection?.matcherVersion,
    skillMatcherModel: input.skillSelection?.matcherModel,
    queryAbstractionArtifactId: abstractionData?.artifact.id,
    skillMatchReportArtifactId: matchReportData?.artifact.id,
    skillInvocationArtifactId: invocationData?.artifact.id,
    skillStepReuse: input.skillStepReuse,
    skillCandidateStatus: "ineligible",
    captureCompleteness: "full",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const artifactItems = [queryData, ...privateDiagnostics.filter((item): item is NonNullable<typeof item> => !!item)];
  await database.transaction("rw", database.taskRuns, database.artifacts, database.artifactContents, async () => {
    await database.artifactContents.bulkPut(artifactItems.map((item) => item.content));
    await database.artifacts.bulkPut(artifactItems.map((item) => item.artifact));
    await database.taskRuns.put(run);
  });
  return run;
}

export async function beginStepCapture(input: {
  runId: string;
  step: PipelineStepName;
  request: unknown;
  modelProfile?: ModelProfile;
  policyId?: string;
  policyVersion?: number;
  steeringHint?: string;
  dependencyArtifactIds?: string[];
  skillSelection?: SkillReuseSelection;
}): Promise<StepRunRecord> {
  const database = getLearningDatabase();
  const previousAttempts = await database.stepRuns.where("[runId+step]").equals([input.runId, input.step]).count();
  const previousSteps = await database.stepRuns.where("runId").equals(input.runId).sortBy("sequence");
  const sequence = previousSteps.length + 1;
  const run = await database.taskRuns.get(input.runId);
  const stepRunId = createLearningId("step");
  const projectedRequest = cleanPrivatePayload(input.request);
  const requestData = await artifactData("step-input", projectedRequest, { runId: input.runId, stepRunId });
  const startedAt = now();
  const upstreamArtifactIds = [...new Set([
    run?.queryArtifactId,
    ...previousSteps.filter((item) => item.status === "completed").flatMap((item) => item.outputArtifactIds),
    ...(input.dependencyArtifactIds ?? []),
  ].filter((id): id is string => !!id))];
  const stepRun: StepRunRecord = {
    id: stepRunId,
    runId: input.runId,
    sequence,
    step: input.step,
    attempt: previousAttempts + 1,
    status: "running",
    inputArtifactIds: [requestData.artifact.id],
    outputArtifactIds: [],
    inputFingerprint: requestData.content.contentHash,
    dependencies: [
      { artifactId: requestData.artifact.id, selectors: ["$"], digest: requestData.content.contentHash },
      ...upstreamArtifactIds.map((artifactId) => ({ artifactId, selectors: ["$"], digest: artifactId })),
    ],
    modelProfile: input.modelProfile,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    steeringHint: input.steeringHint?.slice(0, 500),
    promptSpecHash: PROMPT_SET_HASH,
    skillId: input.skillSelection?.skillId,
    skillVersionId: input.skillSelection?.skillVersionId,
    skillRecipeFingerprint: input.skillSelection?.recipeFingerprint,
    skillMatcherVersion: input.skillSelection?.matcherVersion,
    skillMatcherModel: input.skillSelection?.matcherModel,
    startedAt,
  };
  await database.transaction("rw", database.taskRuns, database.stepRuns, database.artifacts, database.artifactContents, database.artifactLinks, async () => {
    await database.artifactContents.put(requestData.content);
    await database.artifacts.put(requestData.artifact);
    await database.stepRuns.put(stepRun);
    if (upstreamArtifactIds.length) await database.artifactLinks.bulkPut(upstreamArtifactIds.map((fromArtifactId) => ({
      id: createLearningId("link"), runId: input.runId, fromArtifactId, toArtifactId: requestData.artifact.id,
      relation: "consumes" as const, step: input.step, createdAt: startedAt,
    })));
    await database.taskRuns.update(input.runId, { currentStep: input.step, status: "running", updatedAt: startedAt });
  });
  return stepRun;
}

interface CapturedStepOutput {
  inferenceState?: InferenceState;
  questions?: unknown;
  cardPlan?: CardPlan;
  cardPlanMarkdown?: string;
  openuiCode?: string;
  openuiDiagnostics?: unknown;
  assetManifest?: AssetManifest;
  outputs?: Record<string, unknown>;
  provenance?: StepProvenance;
  model?: string;
  modelProfile?: ModelProfile;
  timing?: StepTiming;
  usage?: TokenUsage;
  adaptive?: { policyId: string; policyVersion: number; steeringHint: string };
  skillReuse?: {
    executionMode: "normal" | "guided" | "deterministic" | "fallback";
    callsAvoided: number;
    fallbackReason?: string;
  };
}

function typedOutputs(step: PipelineStepName, output: CapturedStepOutput): Array<[ArtifactKind, unknown]> {
  const artifacts: Array<[ArtifactKind, unknown]> = [];
  if (output.provenance?.profileView) artifacts.push(["profile-view", output.provenance.profileView]);
  if (output.inferenceState) {
    const kind: ArtifactKind = step === "intent_analysis" ? "intent-state"
      : step === "evidence_resolution" ? "evidence-state"
      : step === "context_enrichment" ? "enriched-state"
      : "step-output";
    artifacts.push([kind, output.inferenceState]);
  }
  if (step === "clarification" && output.questions) artifacts.push(["clarification-questions", output.questions]);
  if (output.cardPlan) artifacts.push(["cardplan-json", output.cardPlan]);
  if (output.cardPlanMarkdown) artifacts.push(["cardplan-markdown", output.cardPlanMarkdown]);
  if (output.assetManifest) artifacts.push(["asset-manifest", output.assetManifest]);
  if (output.openuiCode) artifacts.push(["openui-source-initial", output.openuiCode]);
  if (output.openuiDiagnostics) artifacts.push(["openui-diagnostics", output.openuiDiagnostics]);
  return artifacts;
}

export async function completeStepCapture(input: {
  runId: string;
  stepRunId: string;
  step: PipelineStepName;
  output: CapturedStepOutput;
}): Promise<void> {
  const database = getLearningDatabase();
  const main = await artifactData("step-output", input.output, { runId: input.runId, stepRunId: input.stepRunId });
  const extras = await Promise.all(typedOutputs(input.step, input.output).map(([kind, value]) => artifactData(kind, value, { runId: input.runId, stepRunId: input.stepRunId })));
  const all = [main, ...extras];
  const stepRun = await database.stepRuns.get(input.stepRunId);
  if (!stepRun) return;
  const completedAt = now();
  await database.transaction("rw", database.taskRuns, database.stepRuns, database.artifacts, database.artifactContents, database.artifactLinks, async () => {
    await database.artifactContents.bulkPut(all.map((item) => item.content));
    await database.artifacts.bulkPut(all.map((item) => item.artifact));
    await database.artifactLinks.bulkPut(all.flatMap((item) => stepRun.inputArtifactIds.map((fromArtifactId) => ({
      id: createLearningId("link"), runId: input.runId, fromArtifactId, toArtifactId: item.artifact.id,
      relation: "derived-from" as const, step: input.step, createdAt: completedAt,
    }))));
    await database.stepRuns.update(input.stepRunId, {
      status: "completed",
      outputArtifactIds: all.map((item) => item.artifact.id),
      outputFingerprint: main.content.contentHash,
      modelName: input.output.model,
      modelProfile: input.output.modelProfile ?? stepRun.modelProfile,
      policyId: input.output.adaptive?.policyId ?? stepRun.policyId,
      policyVersion: input.output.adaptive?.policyVersion ?? stepRun.policyVersion,
      steeringHint: input.output.adaptive?.steeringHint?.slice(0, 500) ?? stepRun.steeringHint,
      timing: input.output.timing,
      usage: input.output.usage,
      validationArtifactId: extras.find((item) => item.artifact.kind === "openui-diagnostics")?.artifact.id,
      skillExecutionMode: input.output.skillReuse?.executionMode,
      skillCallsAvoided: input.output.skillReuse?.callsAvoided,
      skillFallbackReason: input.output.skillReuse?.fallbackReason,
      completedAt,
    });
    const state = input.step === "clarification" && Array.isArray(input.output.questions) && input.output.questions.length
      ? "waiting-clarification" as const
      : input.step === "openui_generate" ? "completed" as const : "running" as const;
    const inferred = input.output.inferenceState;
    await database.taskRuns.update(input.runId, {
      status: state,
      currentStep: input.step,
      taskFamily: input.output.provenance?.classification.taskFamily,
      decisionMode: input.output.provenance?.classification.decisionMode,
      ...(inferred ? {
        domains: inferred.requestedDomains ?? inferred.retrievalRequests?.flatMap((item) => item.domains) ?? [],
        slotNames: inferred.slotRequirements?.map((item) => item.name) ?? [],
        capabilities: inferred.capabilityCalls?.map((item) => item.capability) ?? [],
      } : {}),
      updatedAt: completedAt,
      ...(state === "completed" ? { completedAt } : {}),
    });
  });
}

export async function failStepCapture(runId: string, stepRunId: string, error: unknown): Promise<void> {
  const database = getLearningDatabase();
  const message = error instanceof Error ? error.message : String(error);
  await database.transaction("rw", database.taskRuns, database.stepRuns, async () => {
    await database.stepRuns.update(stepRunId, { status: "failed", errorCode: "step_failed", errorSummary: message.slice(0, 500), completedAt: now() });
    await database.taskRuns.update(runId, { status: "failed", updatedAt: now() });
  });
}

export async function recordClarificationAnswers(runId: string, answers: Record<number, string>): Promise<string | undefined> {
  if (!Object.keys(answers).length) return undefined;
  const data = await artifactData("clarification-answers", answers, { runId });
  const database = getLearningDatabase();
  await database.transaction("rw", database.artifacts, database.artifactContents, async () => {
    await database.artifactContents.put(data.content);
    await database.artifacts.put(data.artifact);
  });
  return data.artifact.id;
}

export async function recordCardEdit(runId: string, edit: unknown): Promise<void> {
  const data = await artifactData("edit-record", edit, { runId });
  const database = getLearningDatabase();
  await database.transaction("rw", database.artifacts, database.artifactContents, async () => {
    await database.artifactContents.put(data.content);
    await database.artifacts.put(data.artifact);
  });
}

function fallbackIntentKey(value: string): string {
  const normalized = value.toLocaleLowerCase().normalize("NFKC")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 63);
  return /^[a-z]/.test(normalized) && normalized.length >= 3 ? normalized : "general_task";
}

function generalizeText(value: string | undefined, abstraction?: QueryAbstractionV1): string | undefined {
  if (!value) return value;
  let generalized = value;
  for (const parameter of abstraction?.parameters ?? []) {
    const concrete = parameter.value?.trim();
    if (!concrete || [...concrete].length < 2) continue;
    generalized = generalized.split(concrete).join(`{${parameter.key}}`);
  }
  return generalized;
}

function intentTemplate(input: { run: TaskRunRecord; state?: InferenceState; abstraction?: QueryAbstractionV1 }) {
  const requirements = input.state?.slotRequirements ?? [];
  const abstractionByKey = new Map((input.abstraction?.parameters ?? []).map((parameter) => [parameter.key, parameter]));
  const keys = [...new Set([
    ...requirements.map((requirement) => requirement.name),
    ...(input.abstraction?.parameters.map((parameter) => parameter.key) ?? []),
  ])];
  const taskType = input.state?.taskType ?? input.run.taskFamily;
  return {
    intentKey: input.abstraction?.intentKey ?? fallbackIntentKey(taskType),
    displayName: generalizeText(input.abstraction?.displayName ?? taskType, input.abstraction)!,
    invariantSummary: generalizeText(input.abstraction?.invariantSummary ?? `${taskType}的可复用任务流程`, input.abstraction)!,
    invariantTerms: [...new Set((input.abstraction?.invariantTerms ?? [taskType, input.run.taskFamily, input.run.decisionMode])
      .map((term) => generalizeText(term, input.abstraction)!).filter(Boolean))].slice(0, 20),
    parameters: keys.map((key) => {
      const requirement = requirements.find((item) => item.name === key);
      const abstracted = abstractionByKey.get(key);
      return {
        key,
        label: generalizeText(requirement?.label ?? abstracted?.label, input.abstraction),
        valueKind: abstracted?.valueKind ?? parameterKindForKey(key),
        required: requirement?.required ?? true,
        bindingSources: ["query", "profile", "clarification"] as Array<"query" | "profile" | "clarification">,
      };
    }),
  };
}

function indexProfile(input: { run: TaskRunRecord; plan: CardPlan; state?: InferenceState; abstraction?: QueryAbstractionV1 }): SkillIndexProfile {
  const capabilities = [...new Set(input.run.capabilities.map((capability) => {
    if (/image/i.test(capability)) return "host-image-search";
    if (/search|web/i.test(capability)) return "web-search";
    if (/profile|context/i.test(capability)) return "profile-retrieval";
    return "";
  }).filter(Boolean))];
  const generalizedTerms = termsFromQuery([
    generalizeText(input.state?.taskType ?? "", input.abstraction) ?? "",
    input.run.taskFamily,
    input.run.decisionMode,
    ...input.run.domains,
    ...input.run.slotNames,
  ].join(" "));
  const template = intentTemplate(input);
  return {
    taskFamilies: [input.run.taskFamily], decisionModes: [input.run.decisionMode], language: input.run.language,
    domains: input.run.domains, intentTerms: generalizedTerms, slotKeys: input.run.slotNames,
    profileDomains: input.run.domains, capabilities,
    cardArchetypes: [...new Set(input.plan.cards.map((card) => card.presentation?.archetype ?? "standard"))],
    layoutModes: [input.plan.layoutPolicy?.mode ?? input.run.layoutMode],
    actionTypes: [...new Set(input.plan.cards.flatMap((card) => card.actions?.map((action) => action.type) ?? []))],
    requiresFreshData: input.state?.fulfillment?.requiresFreshData ?? false,
    semanticText: [generalizeText(input.state?.taskType, input.abstraction), input.run.taskFamily, input.run.decisionMode, ...input.run.domains, ...input.run.slotNames].filter(Boolean).join(" "),
    intentKey: template.intentKey,
    intentDisplayName: template.displayName,
    invariantTerms: template.invariantTerms,
    parameterKeys: template.parameters.map((parameter) => parameter.key),
    parameterKinds: template.parameters.map((parameter) => parameter.valueKind),
  };
}

function recipeFromRun(input: { run: TaskRunRecord; episode: GenerationEpisode; plan: CardPlan; state?: InferenceState; finalOpenUI: string; abstraction?: QueryAbstractionV1 }): SkillRecipe {
  const profileDomains = [...new Set(input.episode.profileViewSummary?.selectedDomains ?? input.run.domains)];
  const fulfillment = input.state?.fulfillment ?? { outcome: "ideas" as const, requiresFreshData: false, requiresLocation: false, requiresActionLink: false };
  return {
    formatVersion: "genui-skill-recipe/3",
    intentTemplate: intentTemplate(input),
    intentContract: {
      taskFamilies: [input.run.taskFamily], decisionModes: [input.run.decisionMode], taskType: generalizeText(input.state?.taskType ?? input.run.taskFamily, input.abstraction)!,
      fulfillment, queryVariables: input.run.slotNames,
      slotRequirements: (input.state?.slotRequirements ?? []).map((slot) => ({
        key: slot.name, label: generalizeText(slot.label, input.abstraction), description: generalizeText(slot.description, input.abstraction), required: slot.required,
        blocking: !!slot.blocking, weight: slot.weight,
        options: Array.isArray(slot.options) && slot.options.length >= 2
          ? slot.options.slice(0, 4).map((option) => generalizeText(option, input.abstraction)!)
          : undefined,
      })),
    },
    profileBindings: profileDomains.map((domain) => ({
      key: `profile_${domain}`,
      slotKeys: [...new Set((input.state?.retrievalRequests ?? []).filter((request) => request.domains.includes(domain)).flatMap((request) => request.slotNames))],
      domains: [domain], semanticQuery: `Retrieve relevant ${domain} context`, required: false, maxItems: 8, runtimeOnly: true,
    })),
    pipeline: {
      protocol: "six-step-v1",
      steps: (Object.values(input.episode.steps)).filter(Boolean).map((record) => ({
        step: record!.step, hint: generalizeText(record!.steeringHint?.slice(0, 240), input.abstraction), requiredInputs: ["previous-step-output"], outputSchemaVersion: 1,
        reuseStrategy: (["intent_analysis", "clarification", "context_enrichment"] as PipelineStepName[]).includes(record!.step)
          ? "deterministic-eligible" as const : "guide" as const,
      })),
    },
    clarificationPolicy: (input.state?.slotRequirements ?? []).filter((slot) => slot.blocking).map((slot) => ({
      slotKeys: [slot.name], condition: `missing:${slot.name}`,
      questionTemplate: generalizeText(`请确认${slot.label ?? slot.name}，以便生成符合实际约束的方案。`, input.abstraction)!,
      reason: generalizeText(slot.description || "该信息会显著影响方案。", input.abstraction)!,
      options: Array.isArray(slot.options) && slot.options.length >= 2
        ? slot.options.slice(0, 4).map((option) => generalizeText(option, input.abstraction)!)
        : ["优先满足该项", "均衡考虑", "暂不限制"],
      blocking: true,
    })),
    enrichmentPolicy: {
      outcome: fulfillment.outcome,
      requiresFreshData: fulfillment.requiresFreshData,
      capabilities: [...new Set(input.state?.capabilityCalls?.map((item) => item.capability) ?? [])],
    },
    cardPlanRecipe: {
      topology: "adaptive-unbounded",
      cardPatterns: input.plan.cards.map((card) => ({
        archetype: card.presentation?.archetype ?? "standard",
        blockKinds: card.blocks.map((block) => block.kind),
        actionTypes: card.actions?.map((action) => action.type) ?? [],
        assetRoles: card.blocks.flatMap((block) => block.assetRequest ? [block.assetRequest.role] : []),
      })),
      actionPolicy: [...new Set(input.plan.cards.flatMap((card) => card.actions?.map((action) => action.type) ?? []))],
      assetPolicy: [...new Set(input.plan.cards.flatMap((card) => card.blocks.flatMap((block) => block.assetRequest ? [`${block.assetRequest.role}:${block.assetRequest.aspect ?? "auto"}`] : [])))],
      layoutPolicy: input.plan.layoutPolicy?.mode ?? input.run.layoutMode,
    },
    openuiRecipe: {
      preferredPatterns: [...new Set(input.plan.cards.map((card) => card.presentation?.archetype ?? "standard"))],
      componentPreferences: [...new Set([...input.finalOpenUI.matchAll(/^\s*[A-Za-z][\w-]*\s*=\s*([A-Z][\w]*)\s*\(/gm)].map((match) => match[1]))].slice(0, 30),
      mediaPlacementRules: ["Use only host-owned assetRef values"], validationProfile: "strict-host-owned-v1",
    },
    acceptance: { validators: ["topology", "actions", "assets", "layout", "raw-url"], qualitySignals: ["accepted", "edit-count"] },
  };
}

function structuralExample(plan: CardPlan) {
  return {
    layoutMode: plan.layoutPolicy?.mode ?? "free",
    cards: plan.cards.map((card) => ({
      role: card.presentation?.archetype ?? "standard",
      density: card.presentation?.density,
      blockKinds: card.blocks.map((block) => block.kind),
      assetRoles: card.blocks.flatMap((block) => block.assetRequest ? [block.assetRequest.role] : []),
      actionTypes: card.actions?.map((action) => action.type) ?? [],
    })),
  };
}

export async function acceptTaskRunAndCreateCandidate(input: {
  episode: GenerationEpisode;
  finalOpenUI: string;
  cardPlan: CardPlan;
  inferenceState?: InferenceState | null;
  queryAbstraction?: QueryAbstractionV1 | null;
}): Promise<SkillCandidateRecord | null> {
  const database = getLearningDatabase();
  const runId = workflowRunId(input.episode.id);
  const run = await database.taskRuns.get(runId);
  if (!run) return null;
  const finalData = await artifactData("openui-source-final", input.finalOpenUI, { runId });
  const feedbackData = await artifactData("acceptance-feedback", input.episode.rewardMetrics ?? {}, { runId });
  const recipe = recipeFromRun({
    run, episode: input.episode, plan: input.cardPlan, state: input.inferenceState ?? undefined,
    finalOpenUI: input.finalOpenUI, abstraction: input.queryAbstraction ?? undefined,
  });
  const recipeData = await artifactData("skill-recipe", recipe, { runId, sensitivity: "shareable" });
  const exampleData = await artifactData("skill-example", structuralExample(input.cardPlan), { runId, sensitivity: "sanitized" });
  const example: SkillExampleRecord = {
    id: createLearningId("example"), sourceRunId: runId, artifactId: exampleData.artifact.id,
    qualityTier: input.episode.edits.length ? "edited-accepted" : "accepted", createdAt: now(),
  };
  const profile = indexProfile({
    run, plan: input.cardPlan, state: input.inferenceState ?? undefined,
    abstraction: input.queryAbstraction ?? undefined,
  });
  const candidate: SkillCandidateRecord = {
    id: createLearningId("candidate"), runId, status: "pending-comparison",
    candidateRecipeArtifactId: recipeData.artifact.id, candidateExampleId: example.id,
    indexProfile: profile, taskFamilies: profile.taskFamilies, domains: profile.domains, createdAt: now(),
  };
  const items = [finalData, feedbackData, recipeData, exampleData];
  await database.transaction("rw", database.taskRuns, database.artifacts, database.artifactContents, database.skillExamples, database.skillCandidates, async () => {
    await database.artifactContents.bulkPut(items.map((item) => item.content));
    await database.artifacts.bulkPut(items.map((item) => item.artifact));
    await database.skillExamples.put(example);
    await database.skillCandidates.put(candidate);
    await database.taskRuns.update(runId, {
      status: "accepted", skillCandidateStatus: "pending-comparison", acceptedMetrics: input.episode.rewardMetrics,
      acceptedAt: input.episode.acceptedAt ?? now(), updatedAt: now(),
    });
  });
  return candidate;
}

export async function abandonTaskRun(episodeId: string): Promise<void> {
  const database = getLearningDatabase();
  await database.taskRuns.update(workflowRunId(episodeId), { status: "abandoned", updatedAt: now() });
}

export async function failTaskRun(episodeId: string): Promise<void> {
  const database = getLearningDatabase();
  await database.taskRuns.update(workflowRunId(episodeId), { status: "failed", updatedAt: now() });
}

export async function getArtifactPayload<T = unknown>(artifactId: string): Promise<T | undefined> {
  const database = getLearningDatabase();
  const artifact = await database.artifacts.get(artifactId);
  if (!artifact) return undefined;
  return (await database.artifactContents.get(artifact.contentHash))?.payload as T | undefined;
}

export function artifactFingerprint(value: unknown) { return sha256(canonicalJson(cleanPrivatePayload(value))); }
