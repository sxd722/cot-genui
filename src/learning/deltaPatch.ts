import type { CardNode, CardPlan } from "../dsl/modules";
import type { InferenceState } from "../lib/pipelineTypes";
import type { InferConflict, InferSlot } from "../lib/schemas";
import type { ReuseDeltaV1 } from "./workflowTypes";

export interface InferenceStatePatch {
  slots?: InferSlot[];
  conflicts?: InferConflict[];
  assumptions?: string[];
  summary?: string;
}

function parameterValue(change: ReuseDeltaV1["parameterChanges"][number]): string | undefined {
  if (!change.afterValue || typeof change.afterValue !== "object") return undefined;
  const value = (change.afterValue as { value?: unknown }).value;
  return typeof value === "string" ? value : value === undefined ? undefined : String(value);
}

function profileValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => ["string", "number", "boolean"].includes(typeof item))) return value.join("、");
  return undefined;
}

export function canProgramPatchInference(state: InferenceState, delta: ReuseDeltaV1): boolean {
  const knownSlots = new Set([...state.slotRequirements.map((item) => item.name), ...state.slots.map((item) => item.name)]);
  const parameterReady = delta.parameterChanges.every((change) => change.kind !== "removed" && knownSlots.has(change.key) && parameterValue(change) !== undefined);
  const profileReady = delta.profileChanges.every((change) => {
    if (change.kind === "removed") return false;
    const requests = (state.retrievalRequests ?? []).filter((request) => (request.sourcePaths ?? []).includes(change.key));
    return requests.length === 1 && requests[0].slotNames.length === 1 && knownSlots.has(requests[0].slotNames[0]) && profileValue(change.afterValue) !== undefined;
  });
  return parameterReady && profileReady && (delta.parameterChanges.length + delta.profileChanges.length > 0);
}

export function applyProgramInferenceDelta(state: InferenceState, delta: ReuseDeltaV1): InferenceState {
  if (!canProgramPatchInference(state, delta)) throw new Error("当前 delta 不能确定性绑定全部受影响槽位");
  const patches: InferSlot[] = [];
  for (const change of delta.parameterChanges) {
    if (change.kind === "removed") continue;
    const value = parameterValue(change)!;
    patches.push({ name: change.key, value, evidence: "当前 query 明示参数", source_record: `query.${change.key}`, confidence: 1, status: "high" });
  }
  for (const change of delta.profileChanges) {
    const request = (state.retrievalRequests ?? []).find((item) => (item.sourcePaths ?? []).includes(change.key));
    if (!request || change.kind === "removed") continue;
    patches.push({ name: request.slotNames[0], value: profileValue(change.afterValue)!, evidence: "当前相关画像字段", source_record: change.key, confidence: 1, status: "high" });
  }
  return mergeInferenceStatePatch(state, { slots: patches });
}

export function mergeInferenceStatePatch(state: InferenceState, patch: InferenceStatePatch): InferenceState {
  const byName = new Map(state.slots.map((slot) => [slot.name, slot]));
  for (const slot of patch.slots ?? []) {
    if (!slot || typeof slot.name !== "string" || typeof slot.value !== "string"
      || typeof slot.evidence !== "string" || typeof slot.source_record !== "string"
      || typeof slot.confidence !== "number" || slot.confidence < 0 || slot.confidence > 1
      || !["high", "medium", "low", "conflict"].includes(slot.status)) {
      throw new Error("delta slot 结构无效");
    }
    if (!state.slotRequirements.some((requirement) => requirement.name === slot.name) && !byName.has(slot.name)) {
      throw new Error(`delta slot 越界：${slot.name}`);
    }
    byName.set(slot.name, slot);
  }
  return {
    ...state,
    slots: [...byName.values()],
    ...(patch.conflicts ? { conflicts: patch.conflicts } : {}),
    ...(patch.assumptions ? { assumptions: patch.assumptions } : {}),
    ...(typeof patch.summary === "string" ? { summary: patch.summary } : {}),
  };
}

export function mergeCardPlanPatches(plan: CardPlan, patches: CardNode[], allowedCardIds: ReadonlySet<string>): CardPlan {
  const knownIds = new Set(plan.cards.map((card) => card.id));
  const patchById = new Map<string, CardNode>();
  for (const patch of patches) {
    if (!knownIds.has(patch.id) || !allowedCardIds.has(patch.id)) throw new Error(`CardPlan delta 越界：${patch.id}`);
    if (patchById.has(patch.id)) throw new Error(`CardPlan delta 重复：${patch.id}`);
    if (!patch.purpose?.trim() || !Array.isArray(patch.blocks)) throw new Error(`CardPlan delta 结构无效：${patch.id}`);
    patchById.set(patch.id, patch);
  }
  return {
    ...plan,
    cards: plan.cards.map((current) => {
      const patch = patchById.get(current.id);
      if (!patch) return current;
      return {
        ...current,
        title: patch.title ?? current.title,
        purpose: patch.purpose,
        sourceSlots: patch.sourceSlots ?? current.sourceSlots,
        presentation: patch.presentation ?? current.presentation,
        blocks: patch.blocks.map((block) => {
          const sanitized = { ...block };
          delete sanitized.imageUrl;
          return sanitized;
        }),
        // Action identity and topology remain host-owned on delta paths.
        actions: current.actions,
      };
    }),
  };
}

export function publicDeltaSummary(delta: ReuseDeltaV1) {
  const summarize = (changes: ReuseDeltaV1["profileChanges"]) => changes.map(({ key, kind, beforeHash, afterHash }) => ({ key, kind, beforeHash, afterHash }));
  return {
    formatVersion: delta.formatVersion,
    baselineSnapshotId: delta.baselineSnapshotId,
    queryChanged: delta.queryChanged,
    genericIntentChanged: delta.genericIntentChanged,
    layoutChanged: delta.layoutChanged,
    runtimeChanges: delta.runtimeChanges,
    freshnessRequired: delta.freshnessRequired,
    parameterChanges: summarize(delta.parameterChanges),
    profileChanges: summarize(delta.profileChanges),
    affectedSlotNames: delta.affectedSlotNames,
    affectedSteps: delta.affectedSteps,
    affectedCardIds: delta.affectedCardIds,
    reasons: delta.reasons,
  };
}

/** Private model payload: only changed values, never the full historical profile. */
export function privateDeltaValues(delta: ReuseDeltaV1) {
  return {
    parameters: Object.fromEntries(delta.parameterChanges.filter((item) => item.kind !== "removed").map((item) => [item.key, item.afterValue])),
    profile: Object.fromEntries(delta.profileChanges.filter((item) => item.kind !== "removed").map((item) => [item.key, item.afterValue])),
    removedParameters: delta.parameterChanges.filter((item) => item.kind === "removed").map((item) => item.key),
    removedProfileKeys: delta.profileChanges.filter((item) => item.kind === "removed").map((item) => item.key),
  };
}
