import type { CardLayoutMode } from "../dsl/modules";
import { PIPELINE_STEPS, type ModelProfile, type PipelineStepName } from "../lib/pipelineTypes";
import { getLearningDatabase } from "./database";
import { canonicalJson, sha256 } from "./hash";
import { currentRuntimeCompatibility } from "./runtimeCompatibility";
import { canProgramPatchInference } from "./deltaPatch";
import type {
  QueryAbstractionV1,
  ProfileDependencyManifest,
  ReuseDecisionTrace,
  ReuseDeltaChange,
  ReuseDeltaV1,
  ReuseExecutionPlan,
  ReuseSnapshotV1,
  SnapshotLookupResult,
  ReuseTier,
  SkillExecutionModel,
  StepExecutionStrategy,
} from "./workflowTypes";

export { currentRuntimeCompatibility } from "./runtimeCompatibility";

const DEFAULT_HARD_CONSTRAINT = /(?:health|allerg|medical|child|children|household|location|home|budget|maxbudget|预算|过敏|健康|家庭|儿童|地点)/i;

export function normalizeReuseQuery(query: string): string {
  return query.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function getPath(value: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  const direct = parts.reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^\d+$/.test(part)) return current[Number(part)];
    return current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined;
  }, value);
  if (direct !== undefined) return direct;
  const nested = value && typeof value === "object" ? (value as Record<string, unknown>).deviceContext : undefined;
  return nested && nested !== value
    ? parts.reduce<unknown>((current, part) => current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, nested)
    : undefined;
}

function flattenedPaths(value: unknown, prefix = "", output: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenedPaths(item, `${prefix}[${index}]`, output));
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      flattenedPaths(item, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  if (prefix) output.push(prefix);
  return output;
}

function normalizedKeys(input: string[]): string[] {
  return [...new Set(input.map((item) => item.trim()).filter(Boolean))].sort();
}

function selectValues(context: unknown, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = getPath(context, key);
    return value === undefined ? [] : [[key, value] as const];
  }));
}

async function digestValues(values: Record<string, unknown>): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(Object.entries(values).map(async ([key, value]) => [key, await sha256(value)] as const)));
}

function equalValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function equalityRatio(source: Record<string, unknown>, current: Record<string, unknown>): number {
  const keys = Object.keys(source);
  if (!keys.length) return 1;
  return keys.filter((key) => key in current && equalValue(source[key], current[key])).length / keys.length;
}

export async function createProfileDependencyManifest(input: {
  context: unknown;
  domains?: string[];
  retrievalKeys?: string[];
  selectors?: string[];
  hardConstraintKeys?: string[];
}): Promise<ProfileDependencyManifest> {
  const domains = normalizedKeys(input.domains ?? []);
  const retrievalKeys = normalizedKeys(input.retrievalKeys ?? []);
  const selectors = normalizedKeys(input.selectors ?? []);
  const keys = normalizedKeys([
    ...retrievalKeys,
    ...selectors,
    ...(!retrievalKeys.length && !selectors.length ? domains.filter((domain) => getPath(input.context, domain) !== undefined) : []),
  ]);
  const explicitHard = normalizedKeys(input.hardConstraintKeys ?? []);
  const hardPaths = flattenedPaths(input.context).filter((path) => DEFAULT_HARD_CONSTRAINT.test(path));
  const hardConstraintKeys = normalizedKeys([
    ...explicitHard,
    ...keys.filter((key) => DEFAULT_HARD_CONSTRAINT.test(key)),
    ...hardPaths,
  ]);
  const relevantValues = await digestValues(selectValues(input.context, keys));
  const hardConstraintValues = await digestValues(selectValues(input.context, hardConstraintKeys));
  const softValues = Object.fromEntries(Object.entries(relevantValues).filter(([key]) => !hardConstraintKeys.includes(key)));
  return {
    formatVersion: "genui-profile-dependencies/1",
    fullContextHash: await sha256(input.context),
    relevantFingerprint: await sha256(relevantValues),
    hardConstraintFingerprint: await sha256(hardConstraintValues),
    domains,
    retrievalKeys,
    selectors,
    hardConstraintKeys,
    relevantValues,
    hardConstraintValues,
    softValues,
  };
}

export interface ProfileReuseDecision {
  kind: "exact" | "relevant-exact" | "compatible" | "different" | "hard-conflict";
  similarity: number;
  coverage: number;
  hardConflict: boolean;
  reasons: string[];
  relevantFingerprint: string;
}

export async function classifyProfileReuse(manifest: ProfileDependencyManifest, context: unknown): Promise<ProfileReuseDecision> {
  const fullContextHash = await sha256(context);
  if (fullContextHash === manifest.fullContextHash) {
    return { kind: "exact", similarity: 1, coverage: 1, hardConflict: false, reasons: ["完整画像哈希一致"], relevantFingerprint: manifest.relevantFingerprint };
  }
  const keys = normalizedKeys([
    ...manifest.retrievalKeys,
    ...manifest.selectors,
    ...(!manifest.retrievalKeys.length && !manifest.selectors.length ? manifest.domains.filter((domain) => getPath(context, domain) !== undefined) : []),
  ]);
  const relevantValues = await digestValues(selectValues(context, keys));
  const relevantFingerprint = await sha256(relevantValues);
  const sourceKeyCount = Math.max(1, Object.keys(manifest.relevantValues).length);
  const coverage = Object.keys(relevantValues).length / sourceKeyCount;
  const hardValues = await digestValues(selectValues(context, manifest.hardConstraintKeys));
  if (!equalValue(hardValues, manifest.hardConstraintValues)) {
    return { kind: "hard-conflict", similarity: 0, coverage, hardConflict: true, reasons: ["健康、家庭、地点或预算等硬约束发生变化"], relevantFingerprint };
  }
  if (relevantFingerprint === manifest.relevantFingerprint) {
    return { kind: "relevant-exact", similarity: 1, coverage, hardConflict: false, reasons: ["任务相关画像未变化", "仅无关画像字段变化"], relevantFingerprint };
  }
  const softValues = Object.fromEntries(Object.entries(relevantValues).filter(([key]) => !manifest.hardConstraintKeys.includes(key)));
  const similarity = equalityRatio(manifest.softValues, softValues);
  if (coverage >= 0.8 && similarity >= 0.85) {
    return { kind: "compatible", similarity, coverage, hardConflict: false, reasons: [`相关字段覆盖率 ${(coverage * 100).toFixed(0)}%`, `软特征相似度 ${(similarity * 100).toFixed(0)}%`], relevantFingerprint };
  }
  return { kind: "different", similarity, coverage, hardConflict: false, reasons: [`相关字段覆盖率 ${(coverage * 100).toFixed(0)}%`, `软特征相似度 ${(similarity * 100).toFixed(0)}%，未达到复用门槛`], relevantFingerprint };
}

export async function reuseSnapshotKey(input: { query: string; context: unknown; layoutMode: CardLayoutMode }) {
  const compatibility = currentRuntimeCompatibility();
  return {
    queryFingerprint: await sha256(normalizeReuseQuery(input.query)),
    contextFingerprint: await sha256(input.context),
    layoutMode: input.layoutMode,
    compatibilityHash: await sha256(compatibility),
  };
}

export function skillInvocationFingerprint(abstraction: QueryAbstractionV1): Promise<string> {
  return sha256({
    intentKey: abstraction.intentKey,
    parameters: abstraction.parameters.map(({ key, valueKind, value }) => ({ key, valueKind, value })),
    constraints: abstraction.constraints,
  });
}

export function skillGenericInvocationFingerprint(abstraction: QueryAbstractionV1): Promise<string> {
  return sha256({
    intentKey: abstraction.intentKey,
    parameters: abstraction.parameters
      .map(({ key, valueKind }) => ({ key, valueKind }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    constraintKinds: abstraction.constraints.map((item) => item.replace(/[\p{N}]+/gu, "#").trim()).sort(),
  });
}

function isSnapshotSafe(snapshot: ReuseSnapshotV1): boolean {
  const validation = snapshot.validation;
  return validation.accepted && validation.topology && validation.actions && validation.assets && validation.rawUrls && validation.layout;
}

function runtimeChanges(snapshot: ReuseSnapshotV1): Array<keyof ReuseSnapshotV1["compatibility"]> {
  const current = currentRuntimeCompatibility();
  return (Object.keys(current) as Array<keyof typeof current>).filter((key) => snapshot.compatibility[key] !== current[key]);
}

function freshnessStale(snapshot: ReuseSnapshotV1): boolean {
  if (!snapshot.requiresFreshData) return !!snapshot.expiresAt && Date.parse(snapshot.expiresAt) <= Date.now();
  // Legacy realtime snapshots did not persist a TTL and must remain conservative.
  if (!snapshot.expiresAt) return true;
  return Date.parse(snapshot.expiresAt) <= Date.now();
}

export async function findReuseSnapshot(input: { query: string; context: unknown; layoutMode: CardLayoutMode }): Promise<SnapshotLookupResult> {
  const queryFingerprint = await sha256(normalizeReuseQuery(input.query));
  const candidates = await getLearningDatabase().reuseSnapshots.where("queryFingerprint").equals(queryFingerprint).toArray();
  candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (!candidates.length) {
    return {
      recommendedTier: "cold",
      trace: [{ code: "no-accepted-snapshot", outcome: "reject", summary: "没有找到已接受的同 query 私有快照" }],
    };
  }

  const trace: ReuseDecisionTrace[] = [{ code: "query-match", outcome: "pass", summary: "规范化 query 指纹一致" }];
  let partial: SnapshotLookupResult | undefined;
  for (const snapshot of candidates) {
    if (!isSnapshotSafe(snapshot)) {
      trace.push({ code: "validation-rejected", outcome: "reject", summary: "快照未通过全部接受与安全校验", snapshotId: snapshot.id });
      continue;
    }
    const profile = await classifyProfileReuse(snapshot.profileDependencyManifest, input.context);
    const changes = runtimeChanges(snapshot);
    const layoutMatches = snapshot.layoutMode === input.layoutMode;
    const stale = freshnessStale(snapshot);
    const candidateTrace: ReuseDecisionTrace[] = [...trace];
    candidateTrace.push({
      code: profile.kind === "exact" ? "context-match" : profile.kind === "relevant-exact" ? "context-relevant-match" : profile.kind === "compatible" ? "context-compatible" : "context-conflict",
      outcome: profile.kind === "exact" || profile.kind === "relevant-exact" ? "pass" : profile.kind === "compatible" ? "partial" : "reject",
      summary: profile.reasons.join("；") || profile.kind,
      snapshotId: snapshot.id,
      details: { similarity: profile.similarity, coverage: profile.coverage },
    });
    if (!layoutMatches) candidateTrace.push({ code: "layout-mismatch", outcome: "partial", summary: `布局由 ${snapshot.layoutMode} 变为 ${input.layoutMode}`, snapshotId: snapshot.id });
    if (changes.length) candidateTrace.push({ code: "runtime-mismatch", outcome: "partial", summary: `运行时兼容字段变化：${changes.join(", ")}`, snapshotId: snapshot.id, details: { fields: changes } });
    if (stale) candidateTrace.push({ code: "freshness-stale", outcome: "partial", summary: "实时事实或 TTL 已过期，只允许复用静态结构", snapshotId: snapshot.id });

    if (profile.kind === "hard-conflict" || profile.kind === "different") {
      partial ??= { snapshot, recommendedTier: "skill-only", profile, trace: candidateTrace };
      continue;
    }
    if (layoutMatches && !changes.length && !stale && profile.kind === "exact") {
      candidateTrace.push({ code: "ready", outcome: "pass", summary: "快照可直接进行 0 LLM 回放", snapshotId: snapshot.id });
      return { snapshot, recommendedTier: "exact-replay", profile, trace: candidateTrace };
    }
    if (layoutMatches && !changes.length && !stale && profile.kind === "relevant-exact") {
      candidateTrace.push({ code: "ready", outcome: "pass", summary: "任务相关画像一致，可直接回放", snapshotId: snapshot.id });
      return { snapshot, recommendedTier: "relevant-exact", profile, trace: candidateTrace };
    }
    partial ??= { snapshot, recommendedTier: "profile-compatible", profile, trace: candidateTrace };
  }
  return partial ?? { recommendedTier: "cold", trace };
}

export async function putReuseSnapshot(snapshot: ReuseSnapshotV1): Promise<void> {
  await getLearningDatabase().reuseSnapshots.put(snapshot);
}

export const getReuseSnapshot = (id: string) => getLearningDatabase().reuseSnapshots.get(id);

export async function findExactReuseSnapshot(input: { query: string; context: unknown; layoutMode: CardLayoutMode }): Promise<ReuseSnapshotV1 | undefined> {
  const result = await findReuseSnapshot(input);
  return result.recommendedTier === "exact-replay" ? result.snapshot : undefined;
}

function changeKind(before: unknown, after: unknown): ReuseDeltaChange["kind"] {
  if (before === undefined) return "added";
  if (after === undefined) return "removed";
  return "changed";
}

async function diffValues(before: Record<string, unknown>, after: Record<string, unknown>, includeValues: boolean): Promise<ReuseDeltaChange[]> {
  const keys = normalizedKeys([...Object.keys(before), ...Object.keys(after)]);
  const changes: ReuseDeltaChange[] = [];
  for (const key of keys) {
    const beforeHash = typeof before[key] === "string" && /^sha256-/i.test(before[key] as string)
      ? before[key] as string
      : before[key] === undefined ? undefined : await sha256(before[key]);
    const afterHash = after[key] === undefined ? undefined : await sha256(after[key]);
    if (beforeHash === afterHash) continue;
    changes.push({ key, kind: changeKind(before[key], after[key]), beforeHash, afterHash, ...(includeValues && key in after ? { afterValue: after[key] } : {}) });
  }
  return changes;
}

function cardSourceSlots(snapshot: ReuseSnapshotV1, cardId: string): string[] {
  const card = snapshot.artifact.cardPlan.cards.find((item) => item.id === cardId);
  if (!card) return [];
  return normalizedKeys([
    ...(card.sourceSlots ?? []),
    ...card.blocks.flatMap((block) => [
      ...(block.sourceSlots ?? []), block.valueFromSlot, block.itemsFromSlot, block.currentFromSlot,
    ].filter((item): item is string => typeof item === "string")),
  ]);
}

export async function createReuseDelta(input: {
  snapshot: ReuseSnapshotV1;
  query: string;
  abstraction?: QueryAbstractionV1 | null;
  context: unknown;
  layoutMode: CardLayoutMode;
}): Promise<ReuseDeltaV1> {
  const snapshot = input.snapshot;
  const currentQueryFingerprint = await sha256(normalizeReuseQuery(input.query));
  const queryChanged = currentQueryFingerprint !== snapshot.queryFingerprint;
  const sourceAbstraction = snapshot.artifact.queryAbstraction;
  // Reuse the accepted abstraction for an unchanged query. Otherwise a runtime-only
  // delta that runs before Skill matching would look like every parameter was removed.
  const currentAbstraction = input.abstraction ?? (!queryChanged ? sourceAbstraction : undefined);
  const currentGeneric = currentAbstraction ? await skillGenericInvocationFingerprint(currentAbstraction) : undefined;
  const sourceGeneric = snapshot.genericInvocationFingerprint ?? (sourceAbstraction ? await skillGenericInvocationFingerprint(sourceAbstraction) : undefined);
  const genericIntentChanged = !!currentGeneric && !!sourceGeneric && currentGeneric !== sourceGeneric;
  const beforeParameters = Object.fromEntries((sourceAbstraction?.parameters ?? []).map((item) => [item.key, { valueKind: item.valueKind, value: item.value }]));
  const afterParameters = Object.fromEntries((currentAbstraction?.parameters ?? []).map((item) => [item.key, { valueKind: item.valueKind, value: item.value }]));
  const parameterChanges = await diffValues(beforeParameters, afterParameters, true);
  const profileKeys = normalizedKeys([
    ...snapshot.profileDependencyManifest.retrievalKeys,
    ...snapshot.profileDependencyManifest.selectors,
    ...Object.keys(snapshot.profileDependencyManifest.relevantValues),
  ]);
  const currentProfileValues = selectValues(input.context, profileKeys);
  const profileChanges = await diffValues(snapshot.profileDependencyManifest.relevantValues, currentProfileValues, true);
  const changedProfileKeys = new Set(profileChanges.map((item) => item.key));
  const parameterKeys = new Set(parameterChanges.map((item) => item.key));
  const affectedSlotNames = new Set<string>(parameterKeys);
  for (const request of snapshot.artifact.inferenceState.retrievalRequests ?? []) {
    if ((request.sourcePaths ?? []).some((path) => changedProfileKeys.has(path))) request.slotNames.forEach((slot) => affectedSlotNames.add(slot));
  }
  if (profileChanges.length && !affectedSlotNames.size) {
    snapshot.artifact.inferenceState.slotRequirements.forEach((slot) => affectedSlotNames.add(slot.name));
  }
  const runtimeChangeList = runtimeChanges(snapshot);
  const layoutChanged = snapshot.layoutMode !== input.layoutMode;
  const freshnessRequired = freshnessStale(snapshot);
  const semanticChanged = queryChanged || parameterChanges.length > 0 || profileChanges.length > 0;
  const affectedSteps = new Set<PipelineStepName>();
  if (queryChanged || genericIntentChanged || parameterChanges.length) affectedSteps.add("intent_analysis");
  if (semanticChanged) affectedSteps.add("evidence_resolution");
  if (affectedSlotNames.size) affectedSteps.add("clarification");
  if (semanticChanged || freshnessRequired) affectedSteps.add("context_enrichment");
  if (semanticChanged || freshnessRequired || layoutChanged || runtimeChangeList.includes("pipelineVersion") || runtimeChangeList.includes("promptSetHash")) affectedSteps.add("card_plan_generate");
  if (affectedSteps.has("card_plan_generate") || layoutChanged || runtimeChangeList.includes("openuiSpecHash") || runtimeChangeList.includes("featureFlagsHash")) affectedSteps.add("openui_generate");
  const affectedCardIds = snapshot.artifact.cardPlan.cards
    .filter((card) => cardSourceSlots(snapshot, card.id).some((slot) => affectedSlotNames.has(slot) || parameterKeys.has(slot)))
    .map((card) => card.id);
  if (affectedSteps.has("card_plan_generate") && !affectedCardIds.length) affectedCardIds.push(...snapshot.artifact.cardPlan.cards.map((card) => card.id));
  const reasons = [
    ...(queryChanged ? ["query 或参数绑定发生变化"] : []),
    ...(profileChanges.length ? [`相关画像变化 ${profileChanges.length} 项`] : []),
    ...(freshnessRequired ? ["实时事实需要刷新"] : []),
    ...(layoutChanged ? ["卡片布局模式变化"] : []),
    ...(runtimeChangeList.length ? [`运行时变化：${runtimeChangeList.join(", ")}`] : []),
  ];
  return {
    formatVersion: "genui-reuse-delta/1", baselineSnapshotId: snapshot.id,
    queryChanged, genericIntentChanged, layoutChanged, runtimeChanges: runtimeChangeList,
    freshnessRequired, parameterChanges, profileChanges,
    affectedSlotNames: [...affectedSlotNames].sort(),
    affectedSteps: PIPELINE_STEPS.filter((stepName) => affectedSteps.has(stepName)),
    affectedCardIds,
    reasons,
  };
}

export async function findInvocationReuseSnapshot(input: {
  invocationFingerprint: string;
  genericInvocationFingerprint?: string;
  context: unknown;
  layoutMode: CardLayoutMode;
  skillId?: string;
}): Promise<{ snapshot: ReuseSnapshotV1; profile: ProfileReuseDecision } | undefined> {
  const database = getLearningDatabase();
  const genericCandidates = input.genericInvocationFingerprint
    ? await database.reuseSnapshots.where("genericInvocationFingerprint").equals(input.genericInvocationFingerprint).toArray()
    : [];
  const candidates = genericCandidates.length
    ? genericCandidates
    : await database.reuseSnapshots.where("invocationFingerprint").equals(input.invocationFingerprint).toArray();
  candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  let rejected: { snapshot: ReuseSnapshotV1; profile: ProfileReuseDecision } | undefined;
  for (const snapshot of candidates) {
    if (input.skillId && snapshot.skillId && snapshot.skillId !== input.skillId) continue;
    if (!isSnapshotSafe(snapshot)) continue;
    const profile = await classifyProfileReuse(snapshot.profileDependencyManifest, input.context);
    if (profile.kind !== "hard-conflict" && profile.kind !== "different") return { snapshot, profile };
    rejected ??= { snapshot, profile };
  }
  return rejected;
}

export function summarizeExecutionPlan(plan: ReuseExecutionPlan) {
  const values = Object.values(plan.steps);
  return {
    replayedSteps: values.filter((item) => item.strategy === "replay").length,
    deterministicSteps: values.filter((item) => item.strategy === "deterministic" || item.strategy === "program-patch").length,
    weakCalls: values.filter((item) => item.strategy === "weak-delta" || item.strategy === "weak-full").length,
    strongFallbacks: values.filter((item) => item.strategy === "strong-fallback").length,
  };
}

function step(strategy: StepExecutionStrategy, modelProfile: ModelProfile | undefined, reason: string) {
  return { strategy, ...(modelProfile ? { modelProfile } : {}), reason };
}

export function weakModelProfile(model: SkillExecutionModel): ModelProfile {
  return model;
}

export function createReuseExecutionPlan(input: {
  tier: ReuseTier;
  weakModel: SkillExecutionModel;
  snapshot?: ReuseSnapshotV1;
  profileSimilarity?: number;
  hardConstraintConflict?: boolean;
  skillId?: string;
  skillVersionId?: string;
  reasons?: string[];
  delta?: ReuseDeltaV1;
  lookupTrace?: ReuseDecisionTrace[];
}): ReuseExecutionPlan {
  const weak = weakModelProfile(input.weakModel);
  const strategies = Object.fromEntries(PIPELINE_STEPS.map((name): [PipelineStepName, ReturnType<typeof step>] => {
    if (input.snapshot && input.delta) {
      if (!input.delta.affectedSteps.includes(name)) return [name, step("replay", undefined, "该步骤依赖未变化，直接复用已接受快照")];
      const programEligible = !!input.snapshot.artifact.inferenceState
        && canProgramPatchInference(input.snapshot.artifact.inferenceState, input.delta);
      if (programEligible && (name === "intent_analysis" || name === "evidence_resolution")) {
        return [name, step("program-patch", undefined, "当前参数与画像差异可直接绑定到已有槽位，跳过模型")];
      }
      const structuralRuntimeChange = input.delta.layoutChanged
        || input.delta.runtimeChanges.includes("pipelineVersion")
        || (name === "openui_generate" && input.delta.runtimeChanges.some((field) => field === "openuiSpecHash" || field === "featureFlagsHash"));
      if (structuralRuntimeChange || (name === "context_enrichment" && input.delta.freshnessRequired)) {
        return [name, step("weak-full", weak, structuralRuntimeChange ? "结构或运行时契约变化，需要重建当前步骤" : "实时事实过期，需要重新检索并生成")];
      }
      return [name, step("weak-delta", weak, `只处理 ${input.delta.affectedCardIds.length || input.delta.affectedSlotNames.length || 1} 个受影响目标的 typed patch`)];
    }
    if (input.tier === "exact-replay") return [name, step("replay", undefined, "已接受且运行时兼容的私有快照")];
    if (input.tier === "relevant-exact") {
      if (["intent_analysis", "clarification", "context_enrichment"].includes(name)) return [name, step("deterministic", undefined, "Skill 契约与相关画像完全一致")];
      return [name, step("weak-delta", weak, "仅处理参数或表现层增量")];
    }
    if (input.tier === "profile-compatible") {
      if (["intent_analysis", "clarification"].includes(name)) return [name, step("deterministic", undefined, "Skill 契约可确定性实例化")];
      return [name, step("weak-delta", weak, "只发送画像与参数差异")];
    }
    if (input.tier === "skill-only") return [name, step(name === "intent_analysis" || name === "clarification" ? "deterministic" : "weak-full", name === "intent_analysis" || name === "clarification" ? undefined : weak, "复用 Skill 契约，但不复用旧用户事实")];
    return [name, step("weak-full", undefined, "没有可靠 Skill，保持冷启动流程")];
  })) as ReuseExecutionPlan["steps"];
  if (input.snapshot?.artifact.steps) {
    for (const name of PIPELINE_STEPS) {
      const sourceModel = input.snapshot.artifact.steps[name]?.modelProfile;
      if (sourceModel) strategies[name].fallbackModelProfile = sourceModel;
    }
  }
  return {
    tier: input.tier,
    snapshotId: input.snapshot?.id,
    skillId: input.skillId ?? input.snapshot?.skillId,
    skillVersionId: input.skillVersionId ?? input.snapshot?.skillVersionId,
    profileSimilarity: input.profileSimilarity ?? (input.tier === "exact-replay" || input.tier === "relevant-exact" ? 1 : 0),
    hardConstraintConflict: input.hardConstraintConflict ?? false,
    reasons: input.reasons ?? [],
    delta: input.delta,
    lookupTrace: input.lookupTrace,
    steps: strategies,
    ...(input.snapshot ? { estimatedSavings: { ...input.snapshot.baseline } } : {}),
  };
}
