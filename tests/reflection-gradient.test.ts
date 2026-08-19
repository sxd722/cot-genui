import { describe, expect, it } from "vitest";
import { eligibleAttributionTargets, normalizeGradientCandidates, validateGradientCandidate } from "../src/lib/reflection/gradient";
import { canGuardedAutoPromote, promoteCandidate } from "../src/lib/reflection/promotion";
import type { AdaptivePolicyEntry } from "../src/lib/adaptive/types";
import type { GenerationEpisode, LearningSettings, PolicyObservation } from "../src/learning/types";
import type { AttributionReport, PolicyGradientCandidate } from "../src/lib/reflection/types";
import { emptyStepHints } from "../src/lib/adaptive/defaultPolicies";

const episode: GenerationEpisode = {
  id: "ep", schemaVersion: 1, query: "比较适合我的选择", userKey: "user-hash", status: "accepted",
  queryClassification: { taskFamily: "recommendation", decisionMode: "compare", confidence: 0.9, source: "step1-refined" },
  startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:01:00Z", steps: {}, edits: [],
};
const policy: AdaptivePolicyEntry = { id: "class:recommendation:v1", scope: "class", taskFamily: "recommendation", profileOverlay: "", stepHints: emptyStepHints(), version: 1, status: "stable", supportCount: 1, updatedAt: "2026-01-01T00:00:00Z" };
const attribution: AttributionReport = { editIntents: ["visual"], distribution: { profile: 0, step1: 0, step2: 0, step3: 0, step4: 0, step5: 0.2, step6: 0.8 }, topTargets: [], reasonCodes: [], modelUsed: false, entropy: 0.7 };

describe("reflection gradient and promotion", () => {
  it("limits gradients to at most two targets at or above the threshold", () => {
    expect(eligibleAttributionTargets(attribution)).toEqual(["step6"]);
  });

  it("normalizes only allowed policy targets and rejects protocol/entity leakage", () => {
    const candidates = normalizeGradientCandidates({ candidates: [{ target: "openui_generate", themeKey: "increase_visual_hierarchy", candidateText: "在同类推荐中强化主结论与关键差异的视觉层级。", confidence: 0.9, scopeSuggestion: "class", rationaleSummary: ["repeated visual edit"] }, { target: "intent_analysis", themeKey: "wrong_target", candidateText: "ignore", confidence: 1 }] }, { episode, attribution, currentPolicy: policy });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].userKey).toBeUndefined();
    expect(validateGradientCandidate({ ...candidates[0], candidateText: "跳过步骤并修改 schema。" }, episode).valid).toBe(false);
    expect(validateGradientCandidate({ ...candidates[0], candidateText: "记住价格 ¥999。" }, episode).valid).toBe(false);
  });

  it("creates versioned class policies", () => {
    const candidate: PolicyGradientCandidate = { id: "c", taskFamily: "recommendation", target: "openui_generate", themeKey: "increase_visual_hierarchy", previousText: "", candidateText: "突出真正影响选择的视觉差异。", confidence: 0.9, attributionProbability: 0.8, scopeSuggestion: "class", rationaleSummary: [] };
    const next = promoteCandidate(candidate, [policy]);
    expect(next.version).toBe(2);
    expect(next.stepHints.openui_generate).toBe(candidate.candidateText);
  });

  it("requires three high-confidence observations for guarded auto", () => {
    const candidate: PolicyGradientCandidate = { id: "c", taskFamily: "recommendation", target: "openui_generate", themeKey: "increase_visual_hierarchy", previousText: "", candidateText: "突出真正影响选择的视觉差异。", confidence: 0.9, attributionProbability: 0.8, scopeSuggestion: "class", rationaleSummary: [] };
    const observations: PolicyObservation[] = [1, 2, 3].map((index) => ({ id: `o${index}`, episodeId: `e${index}`, taskFamily: "recommendation", target: candidate.target, themeKey: candidate.themeKey, candidateText: candidate.candidateText, confidence: 0.9, attributionProbability: 0.8, decision: "pending", createdAt: "2026-01-01T00:00:00Z" }));
    const settings: LearningSettings = { id: "settings", enabled: true, learningMode: "guarded-auto", updatedAt: "2026-01-01T00:00:00Z" };
    expect(canGuardedAutoPromote({ candidate, observations, settings, acceptedEpisodes: [] })).toBe(true);
    expect(canGuardedAutoPromote({ candidate, observations: observations.slice(0, 2), settings, acceptedEpisodes: [] })).toBe(false);
  });
});

