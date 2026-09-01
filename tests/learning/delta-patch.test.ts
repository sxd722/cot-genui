import { describe, expect, it } from "vitest";
import { applyProgramInferenceDelta, canProgramPatchInference, mergeCardPlanPatches, mergeInferenceStatePatch, publicDeltaSummary } from "../../src/learning/deltaPatch";
import type { CardPlan } from "../../src/dsl/modules";
import type { InferenceState } from "../../src/lib/pipelineTypes";
import type { ReuseDeltaV1 } from "../../src/learning/workflowTypes";

const state: InferenceState = {
  taskType: "travel", needsContext: true,
  slotRequirements: [{ name: "destination", description: "目的地", required: true }],
  slots: [{ name: "destination", value: "北京", evidence: "query", source_record: "query", confidence: 1, status: "high" }],
  conflicts: [], questions: [], assumptions: [], summary: "北京旅行",
};

const plan: CardPlan = {
  skillName: "旅行", reasoning: "fixture", cards: [
    {
      id: "overview", purpose: "行程总览", sourceSlots: ["destination"],
      blocks: [{ kind: "summary", text: "北京三日游" }],
      actions: [{ id: "open", label: "查看", type: "navigate", targetCardId: "detail" }],
    },
    { id: "detail", purpose: "详情", blocks: [{ kind: "summary", text: "不变" }] },
  ],
};

describe("typed reuse delta patches", () => {
  it("merges slot patches without replacing the inference contract", () => {
    const merged = mergeInferenceStatePatch(state, {
      slots: [{ name: "destination", value: "西安", evidence: "query", source_record: "query", confidence: 1, status: "high" }],
      summary: "西安旅行",
    });
    expect(merged.slots).toEqual([expect.objectContaining({ name: "destination", value: "西安" })]);
    expect(merged.slotRequirements).toEqual(state.slotRequirements);
    expect(merged.summary).toBe("西安旅行");
  });

  it("patches only allowed cards and preserves action topology", () => {
    const merged = mergeCardPlanPatches(plan, [{ id: "overview", purpose: "西安行程", blocks: [{ kind: "summary", text: "西安三日游" }], actions: [] }], new Set(["overview"]));
    expect(merged.cards[0]).toMatchObject({ id: "overview", purpose: "西安行程", blocks: [{ text: "西安三日游" }] });
    expect(merged.cards[0].actions).toEqual(plan.cards[0].actions);
    expect(merged.cards[1]).toEqual(plan.cards[1]);
    expect(() => mergeCardPlanPatches(plan, [{ id: "detail", purpose: "bad", blocks: [] }], new Set(["overview"]))).toThrow(/越界/);
  });

  it("redacts private delta values from diagnostics", () => {
    const delta: ReuseDeltaV1 = {
      formatVersion: "genui-reuse-delta/1", baselineSnapshotId: "snapshot", queryChanged: false,
      genericIntentChanged: false, layoutChanged: false, runtimeChanges: [], freshnessRequired: false,
      parameterChanges: [], profileChanges: [{ key: "health.note", kind: "changed", afterHash: "sha256-x", afterValue: "private" }],
      affectedSlotNames: ["health"], affectedSteps: ["evidence_resolution"], affectedCardIds: [], reasons: [],
    };
    expect(JSON.stringify(publicDeltaSummary(delta))).not.toContain("private");
  });

  it("binds explicit parameter deltas without an LLM", () => {
    const delta: ReuseDeltaV1 = {
      formatVersion: "genui-reuse-delta/1", baselineSnapshotId: "snapshot", queryChanged: true,
      genericIntentChanged: false, layoutChanged: false, runtimeChanges: [], freshnessRequired: false,
      parameterChanges: [{ key: "destination", kind: "changed", afterValue: { valueKind: "location", value: "西安" } }],
      profileChanges: [], affectedSlotNames: ["destination"], affectedSteps: ["intent_analysis", "evidence_resolution"],
      affectedCardIds: ["overview"], reasons: [],
    };
    expect(canProgramPatchInference(state, delta)).toBe(true);
    expect(applyProgramInferenceDelta(state, delta).slots[0]).toMatchObject({ name: "destination", value: "西安", confidence: 1 });
  });

  it("does not program-patch removal of a required parameter", () => {
    const delta: ReuseDeltaV1 = {
      formatVersion: "genui-reuse-delta/1", baselineSnapshotId: "snapshot", queryChanged: true,
      genericIntentChanged: false, layoutChanged: false, runtimeChanges: [], freshnessRequired: false,
      parameterChanges: [{ key: "destination", kind: "removed", beforeHash: "sha256-before" }],
      profileChanges: [], affectedSlotNames: ["destination"], affectedSteps: ["intent_analysis", "evidence_resolution"],
      affectedCardIds: ["overview"], reasons: [],
    };
    expect(canProgramPatchInference(state, delta)).toBe(false);
  });
});
