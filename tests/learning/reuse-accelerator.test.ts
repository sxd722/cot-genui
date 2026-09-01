import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEARNING_DB_NAME, resetLearningDatabaseSingleton } from "../../src/learning/database";
import {
  classifyProfileReuse,
  createReuseDelta,
  createProfileDependencyManifest,
  currentRuntimeCompatibility,
  createReuseExecutionPlan,
  findExactReuseSnapshot,
  findInvocationReuseSnapshot,
  findReuseSnapshot,
  normalizeReuseQuery,
  putReuseSnapshot,
  reuseSnapshotKey,
  skillGenericInvocationFingerprint,
  skillInvocationFingerprint,
  summarizeExecutionPlan,
} from "../../src/learning/reuseAccelerator";
import type { QueryAbstractionV1, ReuseSnapshotV1 } from "../../src/learning/workflowTypes";

const sourceProfile = {
  travel: { seat: "aisle", pace: "slow", cabin: "economy", hotel: "quiet", food: "local", transport: "rail", schedule: "morning", style: "family" },
  household: { children: 1 },
  health: { allergies: ["peanut"] },
  unrelated: { theme: "dark" },
};

beforeEach(async () => {
  resetLearningDatabaseSingleton();
  await Dexie.delete(LEARNING_DB_NAME);
});

afterEach(async () => {
  resetLearningDatabaseSingleton();
  await Dexie.delete(LEARNING_DB_NAME);
});

describe("reuse accelerator", () => {
  it("normalizes semantically identical query text before indexing", () => {
    expect(normalizeReuseQuery("  去\u00a0北京旅行  ")).toBe("去 北京旅行");
    expect(normalizeReuseQuery("ＡＢＣ　行程")).toBe("ABC 行程");
  });

  it("separates generic Skill identity from concrete parameter bindings", async () => {
    const abstraction = (destination: string): QueryAbstractionV1 => ({
      formatVersion: "genui-query-abstraction/1",
      intentKey: "travel_planning",
      displayName: "旅游规划",
      invariantSummary: "规划去指定目的地的旅行",
      invariantTerms: ["旅行", "规划"],
      parameters: [{ key: "destination", valueKind: "location", value: destination, source: "query", confidence: 0.95 }],
      constraints: [],
      confidence: 0.95,
    });
    expect(await skillGenericInvocationFingerprint(abstraction("北京"))).toBe(await skillGenericInvocationFingerprint(abstraction("西安")));
  });

  it("turns reuse tiers into auditable per-step execution strategies", () => {
    const exact = createReuseExecutionPlan({ tier: "exact-replay", weakModel: "groq_qwen_3_6_27b" });
    expect(summarizeExecutionPlan(exact)).toMatchObject({ replayedSteps: 6, weakCalls: 0 });
    const compatible = createReuseExecutionPlan({ tier: "profile-compatible", weakModel: "glm_4_7_flash", profileSimilarity: 0.9 });
    expect(compatible.steps.intent_analysis.strategy).toBe("deterministic");
    expect(compatible.steps.card_plan_generate).toMatchObject({ strategy: "weak-delta", modelProfile: "glm_4_7_flash" });
    expect(summarizeExecutionPlan(compatible)).toMatchObject({ deterministicSteps: 2, weakCalls: 4 });
  });

  it("replays unaffected steps and only patches the computed delta steps", () => {
    const delta = {
      formatVersion: "genui-reuse-delta/1", baselineSnapshotId: "snapshot", queryChanged: false,
      genericIntentChanged: false, layoutChanged: false, runtimeChanges: [], freshnessRequired: false,
      parameterChanges: [], profileChanges: [{ key: "travel.seat", kind: "changed" }],
      affectedSlotNames: ["seat"], affectedSteps: ["evidence_resolution", "card_plan_generate", "openui_generate"],
      affectedCardIds: ["transport"], reasons: ["seat changed"],
    } satisfies import("../../src/learning/workflowTypes").ReuseDeltaV1;
    const plan = createReuseExecutionPlan({
      tier: "profile-compatible", weakModel: "groq_qwen_3_6_27b", delta,
      snapshot: { id: "snapshot", artifact: {} } as ReuseSnapshotV1,
    });
    expect(plan.steps.intent_analysis.strategy).toBe("replay");
    expect(plan.steps.evidence_resolution.strategy).toBe("weak-delta");
    expect(plan.steps.context_enrichment.strategy).toBe("replay");
    expect(plan.steps.openui_generate.strategy).toBe("weak-delta");
  });

  it("separates full-context equality from relevant-profile equality", async () => {
    const manifest = await createProfileDependencyManifest({
      context: sourceProfile,
      domains: ["travel", "health"],
      retrievalKeys: ["travel.seat", "travel.pace", "travel.cabin", "travel.hotel", "travel.food", "travel.transport", "travel.schedule", "travel.style", "health.allergies"],
      hardConstraintKeys: ["health.allergies"],
    });
    const unrelatedChanged = {
      ...sourceProfile,
      unrelated: { theme: "light" },
    };
    const decision = await classifyProfileReuse(manifest, unrelatedChanged);
    expect(decision.kind).toBe("relevant-exact");
    expect(decision.similarity).toBe(1);
  });

  it("allows compatible soft-profile deltas but blocks hard-constraint changes", async () => {
    const manifest = await createProfileDependencyManifest({
      context: sourceProfile,
      domains: ["travel", "health"],
      retrievalKeys: ["travel.seat", "travel.pace", "travel.cabin", "travel.hotel", "travel.food", "travel.transport", "travel.schedule", "travel.style", "health.allergies"],
      hardConstraintKeys: ["health.allergies"],
    });
    const compatible = await classifyProfileReuse(manifest, {
      ...sourceProfile,
      travel: { ...sourceProfile.travel, seat: "window" },
    });
    expect(compatible.kind).toBe("compatible");
    expect(compatible.hardConflict).toBe(false);

    const conflict = await classifyProfileReuse(manifest, {
      ...sourceProfile,
      health: { allergies: ["shellfish"] },
    });
    expect(conflict.kind).toBe("hard-conflict");
    expect(conflict.hardConflict).toBe(true);
  });

  it("finds only runtime-compatible exact snapshots", async () => {
    const runtime = currentRuntimeCompatibility();
    const key = await reuseSnapshotKey({ query: "去北京旅行", context: sourceProfile, layoutMode: "free" });
    const snapshot: ReuseSnapshotV1 = {
      id: "snapshot_1",
      formatVersion: "genui-reuse-snapshot/1",
      sourceRunId: "run_1",
      queryFingerprint: key.queryFingerprint,
      contextFingerprint: key.contextFingerprint,
      relevantProfileFingerprint: key.contextFingerprint,
      invocationFingerprint: "sha256-invocation",
      layoutMode: "free",
      compatibility: runtime,
      compatibilityHash: key.compatibilityHash,
      requiresFreshData: false,
      profileDependencyManifest: {
        formatVersion: "genui-profile-dependencies/1",
        fullContextHash: key.contextFingerprint,
        relevantFingerprint: key.contextFingerprint,
        hardConstraintFingerprint: "sha256-hard",
        domains: [], retrievalKeys: [], selectors: [], hardConstraintKeys: [],
        relevantValues: {}, hardConstraintValues: {}, softValues: {},
      },
      artifact: {
        cardPlan: { skillName: "旅行", reasoning: "fixture", cards: [] },
        cardPlanMarkdown: "# 旅行",
        openuiCode: "root = CardDeck([])",
        inferenceState: { taskType: "travel", needsContext: false, slotRequirements: [], slots: [], conflicts: [], questions: [], assumptions: [] },
        assetManifest: { requests: [], assets: [] },
      },
      validation: { accepted: true, topology: true, actions: true, assets: true, rawUrls: true, layout: true },
      baseline: { durationMs: 12000, promptTokens: 9000, completionTokens: 1200 },
      createdAt: new Date().toISOString(),
    };
    await putReuseSnapshot(snapshot);
    expect((await findExactReuseSnapshot({ query: "去北京旅行", context: sourceProfile, layoutMode: "free" }))?.id).toBe(snapshot.id);
    expect(await findExactReuseSnapshot({ query: "去北京旅行", context: sourceProfile, layoutMode: "fixed-600x300" })).toBeUndefined();

    await putReuseSnapshot({
      ...snapshot,
      id: "snapshot_stale",
      compatibility: { ...runtime, openuiSpecHash: "stale" },
      compatibilityHash: "sha256-stale",
      createdAt: new Date(Date.now() + 1_000).toISOString(),
    });
    expect((await findExactReuseSnapshot({ query: "去北京旅行", context: sourceProfile, layoutMode: "free" }))?.id).toBe(snapshot.id);
  });

  it("returns structured lookup diagnostics instead of silently dropping candidates", async () => {
    const runtime = currentRuntimeCompatibility();
    const key = await reuseSnapshotKey({ query: "去北京旅行", context: sourceProfile, layoutMode: "free" });
    const snapshot: ReuseSnapshotV1 = {
      id: "snapshot_trace", formatVersion: "genui-reuse-snapshot/1", sourceRunId: "run_trace",
      queryFingerprint: key.queryFingerprint, contextFingerprint: key.contextFingerprint,
      relevantProfileFingerprint: key.contextFingerprint, invocationFingerprint: "binding",
      genericInvocationFingerprint: "generic", layoutMode: "free", compatibility: runtime,
      compatibilityHash: key.compatibilityHash, requiresFreshData: false,
      profileDependencyManifest: {
        formatVersion: "genui-profile-dependencies/1", fullContextHash: key.contextFingerprint,
        relevantFingerprint: key.contextFingerprint, hardConstraintFingerprint: "hard",
        domains: ["travel"], retrievalKeys: ["travel.seat"], selectors: [], hardConstraintKeys: [],
        relevantValues: { "travel.seat": "digest" }, hardConstraintValues: {}, softValues: { "travel.seat": "digest" },
      },
      artifact: {
        cardPlan: { skillName: "旅行", reasoning: "fixture", cards: [] }, cardPlanMarkdown: "# 旅行",
        openuiCode: "root = CardDeck([])", inferenceState: { taskType: "travel", needsContext: false, slotRequirements: [], slots: [], conflicts: [], questions: [], assumptions: [] },
        assetManifest: { requests: [], assets: [] },
      },
      validation: { accepted: true, topology: true, actions: true, assets: true, rawUrls: true, layout: true },
      baseline: { durationMs: 1000, promptTokens: 100, completionTokens: 20 }, createdAt: new Date().toISOString(),
    };
    await putReuseSnapshot(snapshot);
    const layoutMiss = await findReuseSnapshot({ query: "去北京旅行", context: sourceProfile, layoutMode: "fixed-600x300" });
    expect(layoutMiss.snapshot?.id).toBe(snapshot.id);
    expect(layoutMiss.recommendedTier).toBe("profile-compatible");
    expect(layoutMiss.trace).toEqual(expect.arrayContaining([expect.objectContaining({ code: "layout-mismatch", outcome: "partial" })]));
  });

  it("turns stale realtime facts into a partial delta instead of discarding the snapshot", async () => {
    const key = await reuseSnapshotKey({ query: "今天北京天气", context: sourceProfile, layoutMode: "free" });
    const runtime = currentRuntimeCompatibility();
    const snapshot: ReuseSnapshotV1 = {
      id: "snapshot_weather_delta", formatVersion: "genui-reuse-snapshot/1", sourceRunId: "run_weather_delta",
      queryFingerprint: key.queryFingerprint, contextFingerprint: key.contextFingerprint,
      relevantProfileFingerprint: key.contextFingerprint, invocationFingerprint: "weather-binding",
      genericInvocationFingerprint: "weather-generic", layoutMode: "free", compatibility: runtime,
      compatibilityHash: key.compatibilityHash, requiresFreshData: true,
      profileDependencyManifest: {
        formatVersion: "genui-profile-dependencies/1", fullContextHash: key.contextFingerprint,
        relevantFingerprint: key.contextFingerprint, hardConstraintFingerprint: "hard",
        domains: [], retrievalKeys: [], selectors: [], hardConstraintKeys: [], relevantValues: {}, hardConstraintValues: {}, softValues: {},
      },
      artifact: {
        cardPlan: { skillName: "天气", reasoning: "fixture", cards: [] }, cardPlanMarkdown: "# 天气",
        openuiCode: "root = CardDeck([])", inferenceState: { taskType: "weather", fulfillment: { outcome: "verified_recommendations", requiresFreshData: true, requiresLocation: true, requiresActionLink: false }, needsContext: false, slotRequirements: [], slots: [], conflicts: [], questions: [], assumptions: [] },
        assetManifest: { requests: [], assets: [] },
      },
      validation: { accepted: true, topology: true, actions: true, assets: true, rawUrls: true, layout: true },
      baseline: { durationMs: 1000, promptTokens: 100, completionTokens: 20 }, createdAt: new Date().toISOString(),
    };
    await putReuseSnapshot(snapshot);
    const result = await findReuseSnapshot({ query: "今天北京天气", context: sourceProfile, layoutMode: "free" });
    expect(result.snapshot?.id).toBe(snapshot.id);
    expect(result.recommendedTier).toBe("profile-compatible");
    expect(result.trace).toEqual(expect.arrayContaining([expect.objectContaining({ code: "freshness-stale", outcome: "partial" })]));
  });

  it("allows a realtime snapshot to replay until its TTL expires", async () => {
    const key = await reuseSnapshotKey({ query: "今天北京天气", context: sourceProfile, layoutMode: "free" });
    const snapshot: ReuseSnapshotV1 = {
      id: "snapshot_weather_fresh", formatVersion: "genui-reuse-snapshot/1", sourceRunId: "run_weather_fresh",
      queryFingerprint: key.queryFingerprint, contextFingerprint: key.contextFingerprint,
      relevantProfileFingerprint: key.contextFingerprint, invocationFingerprint: "weather-binding-fresh",
      layoutMode: "free", compatibility: currentRuntimeCompatibility(), compatibilityHash: key.compatibilityHash,
      requiresFreshData: true, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      profileDependencyManifest: {
        formatVersion: "genui-profile-dependencies/1", fullContextHash: key.contextFingerprint,
        relevantFingerprint: key.contextFingerprint, hardConstraintFingerprint: "hard",
        domains: [], retrievalKeys: [], selectors: [], hardConstraintKeys: [], relevantValues: {}, hardConstraintValues: {}, softValues: {},
      },
      artifact: {
        cardPlan: { skillName: "天气", reasoning: "fixture", cards: [] }, cardPlanMarkdown: "# 天气",
        openuiCode: "root = CardDeck([])", inferenceState: { taskType: "weather", needsContext: false, slotRequirements: [], slots: [], conflicts: [], questions: [], assumptions: [] },
      },
      validation: { accepted: true, topology: true, actions: true, assets: true, rawUrls: true, layout: true },
      baseline: { durationMs: 1, promptTokens: 1, completionTokens: 1 }, createdAt: new Date().toISOString(),
    };
    await putReuseSnapshot(snapshot);
    expect((await findExactReuseSnapshot({ query: "今天北京天气", context: sourceProfile, layoutMode: "free" }))?.id).toBe(snapshot.id);
  });

  it("does not infer removed parameters when the same query has not been re-abstracted", async () => {
    const abstraction: QueryAbstractionV1 = {
      formatVersion: "genui-query-abstraction/1", intentKey: "travel_planning", displayName: "旅游规划",
      invariantSummary: "规划目的地旅行", invariantTerms: ["旅行"],
      parameters: [{ key: "destination", valueKind: "location", value: "北京", source: "query", confidence: 0.9 }],
      constraints: [], confidence: 0.9,
    };
    const key = await reuseSnapshotKey({ query: "去北京旅行", context: sourceProfile, layoutMode: "free" });
    const manifest = await createProfileDependencyManifest({ context: sourceProfile });
    const snapshot = {
      id: "snapshot_same_query", formatVersion: "genui-reuse-snapshot/1", sourceRunId: "run_same_query",
      queryFingerprint: key.queryFingerprint, contextFingerprint: key.contextFingerprint,
      relevantProfileFingerprint: manifest.relevantFingerprint, invocationFingerprint: await skillInvocationFingerprint(abstraction),
      genericInvocationFingerprint: await skillGenericInvocationFingerprint(abstraction), layoutMode: "free",
      compatibility: currentRuntimeCompatibility(), compatibilityHash: key.compatibilityHash, requiresFreshData: false,
      profileDependencyManifest: manifest,
      artifact: {
        queryAbstraction: abstraction,
        inferenceState: { taskType: "travel", needsContext: false, slotRequirements: [], slots: [], conflicts: [], questions: [], assumptions: [] },
        cardPlan: { skillName: "旅行", reasoning: "fixture", cards: [] }, cardPlanMarkdown: "# 旅行", openuiCode: "root = CardDeck([])",
      },
      validation: { accepted: true, topology: true, actions: true, assets: true, rawUrls: true, layout: true },
      baseline: { durationMs: 1, promptTokens: 1, completionTokens: 1 }, createdAt: new Date().toISOString(),
    } satisfies ReuseSnapshotV1;
    const delta = await createReuseDelta({ snapshot, query: "去北京旅行", context: sourceProfile, layoutMode: "free" });
    expect(delta.parameterChanges).toEqual([]);
    expect(delta.queryChanged).toBe(false);
  });

  it("computes affected cards from parameter and profile deltas", async () => {
    const runtime = currentRuntimeCompatibility();
    const sourceAbstraction: QueryAbstractionV1 = {
      formatVersion: "genui-query-abstraction/1", intentKey: "travel_planning", displayName: "旅游规划",
      invariantSummary: "规划目的地旅行", invariantTerms: ["旅行"],
      parameters: [{ key: "destination", valueKind: "location", value: "北京", source: "query", confidence: 0.9 }], constraints: [], confidence: 0.9,
    };
    const manifest = await createProfileDependencyManifest({ context: sourceProfile, retrievalKeys: ["travel.seat"] });
    const snapshot = {
      id: "snapshot_delta", formatVersion: "genui-reuse-snapshot/1", sourceRunId: "run_delta",
      queryFingerprint: "query", contextFingerprint: manifest.fullContextHash, relevantProfileFingerprint: manifest.relevantFingerprint,
      invocationFingerprint: "binding", genericInvocationFingerprint: await skillGenericInvocationFingerprint(sourceAbstraction),
      layoutMode: "free", compatibility: runtime, compatibilityHash: "compat", requiresFreshData: false,
      profileDependencyManifest: manifest,
      artifact: {
        queryAbstraction: sourceAbstraction,
        inferenceState: {
          taskType: "travel", needsContext: true,
          slotRequirements: [{ name: "destination", description: "目的地", required: true }, { name: "seat", description: "座位", required: false }],
          slots: [], conflicts: [], questions: [], assumptions: [],
          retrievalRequests: [{ domains: ["travel"], semanticQuery: "seat", slotNames: ["seat"], sourcePaths: ["travel.seat"] }],
        },
        cardPlan: {
          skillName: "旅行", reasoning: "fixture", cards: [
            { id: "overview", purpose: "总览", sourceSlots: ["destination"], blocks: [{ kind: "summary", text: "北京" }] },
            { id: "transport", purpose: "交通", sourceSlots: ["seat"], blocks: [{ kind: "summary", text: "过道座" }] },
          ],
        },
        cardPlanMarkdown: "# 旅行", openuiCode: "root = CardDeck([])", assetManifest: { requests: [], assets: [] },
      },
      validation: { accepted: true, topology: true, actions: true, assets: true, rawUrls: true, layout: true },
      baseline: { durationMs: 1, promptTokens: 1, completionTokens: 1 }, createdAt: new Date().toISOString(),
    } satisfies ReuseSnapshotV1;
    const currentAbstraction = { ...sourceAbstraction, parameters: [{ ...sourceAbstraction.parameters[0], value: "西安" }] };
    const delta = await createReuseDelta({
      snapshot,
      query: "去西安旅行",
      abstraction: currentAbstraction,
      context: { ...sourceProfile, travel: { ...sourceProfile.travel, seat: "window" } },
      layoutMode: "free",
    });
    expect(delta.parameterChanges.map((item) => item.key)).toContain("destination");
    expect(delta.profileChanges.map((item) => item.key)).toContain("travel.seat");
    expect(delta.affectedCardIds).toEqual(["overview", "transport"]);
    expect(delta.affectedSteps).toEqual(expect.arrayContaining(["intent_analysis", "evidence_resolution", "card_plan_generate", "openui_generate"]));
  });

  it("finds a prior snapshot by generic invocation when parameter values differ", async () => {
    const abstraction = (destination: string): QueryAbstractionV1 => ({
      formatVersion: "genui-query-abstraction/1", intentKey: "travel_planning", displayName: "旅游规划",
      invariantSummary: "规划目的地旅行", invariantTerms: ["旅行"],
      parameters: [{ key: "destination", valueKind: "location", value: destination, source: "query", confidence: 0.9 }], constraints: [], confidence: 0.9,
    });
    const source = abstraction("北京");
    const target = abstraction("西安");
    const manifest = await createProfileDependencyManifest({ context: sourceProfile, retrievalKeys: ["travel.seat"] });
    const key = await reuseSnapshotKey({ query: "去北京旅行", context: sourceProfile, layoutMode: "free" });
    const snapshot = {
      id: "snapshot_generic", formatVersion: "genui-reuse-snapshot/1", sourceRunId: "run_generic",
      queryFingerprint: key.queryFingerprint, contextFingerprint: key.contextFingerprint, relevantProfileFingerprint: manifest.relevantFingerprint,
      invocationFingerprint: await skillInvocationFingerprint(source), genericInvocationFingerprint: await skillGenericInvocationFingerprint(source),
      layoutMode: "free", compatibility: currentRuntimeCompatibility(), compatibilityHash: key.compatibilityHash, requiresFreshData: false,
      profileDependencyManifest: manifest,
      artifact: {
        queryAbstraction: source,
        inferenceState: { taskType: "travel", needsContext: false, slotRequirements: [], slots: [], conflicts: [], questions: [], assumptions: [] },
        cardPlan: { skillName: "旅行", reasoning: "fixture", cards: [] }, cardPlanMarkdown: "# 旅行", openuiCode: "root = CardDeck([])",
      },
      validation: { accepted: true, topology: true, actions: true, assets: true, rawUrls: true, layout: true },
      baseline: { durationMs: 1, promptTokens: 1, completionTokens: 1 }, createdAt: new Date().toISOString(),
    } satisfies ReuseSnapshotV1;
    await putReuseSnapshot(snapshot);
    const found = await findInvocationReuseSnapshot({
      invocationFingerprint: await skillInvocationFingerprint(target),
      genericInvocationFingerprint: await skillGenericInvocationFingerprint(target),
      context: sourceProfile,
      layoutMode: "free",
    });
    expect(found?.snapshot.id).toBe(snapshot.id);
  });

  it("does not replay tasks whose facts require freshness", async () => {
    const key = await reuseSnapshotKey({ query: "今天北京天气", context: sourceProfile, layoutMode: "free" });
    const runtime = currentRuntimeCompatibility();
    await putReuseSnapshot({
      id: "snapshot_fresh", formatVersion: "genui-reuse-snapshot/1", sourceRunId: "run_weather",
      queryFingerprint: key.queryFingerprint, contextFingerprint: key.contextFingerprint,
      relevantProfileFingerprint: key.contextFingerprint, invocationFingerprint: "sha256-weather", layoutMode: "free",
      compatibility: runtime, compatibilityHash: key.compatibilityHash, requiresFreshData: true,
      profileDependencyManifest: {
        formatVersion: "genui-profile-dependencies/1", fullContextHash: key.contextFingerprint,
        relevantFingerprint: key.contextFingerprint, hardConstraintFingerprint: "sha256-hard",
        domains: [], retrievalKeys: [], selectors: [], hardConstraintKeys: [], relevantValues: {}, hardConstraintValues: {}, softValues: {},
      },
      artifact: {
        cardPlan: { skillName: "天气", reasoning: "fixture", cards: [] }, cardPlanMarkdown: "# 天气",
        openuiCode: "root = CardDeck([])", inferenceState: { taskType: "weather", needsContext: false, slotRequirements: [], slots: [], conflicts: [], questions: [], assumptions: [] },
        assetManifest: { requests: [], assets: [] },
      },
      validation: { accepted: true, topology: true, actions: true, assets: true, rawUrls: true, layout: true },
      baseline: { durationMs: 1000, promptTokens: 100, completionTokens: 20 }, createdAt: new Date().toISOString(),
    });
    expect(await findExactReuseSnapshot({ query: "今天北京天气", context: sourceProfile, layoutMode: "free" })).toBeUndefined();
  });
});
