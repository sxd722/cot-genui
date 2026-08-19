import { describe, expect, it } from "vitest";
import { classifyQuery } from "../src/lib/adaptive/classification";
import { emptyStepHints } from "../src/lib/adaptive/defaultPolicies";
import { resolveEffectivePolicy } from "../src/lib/adaptive/policy";
import type { AdaptivePolicyEntry } from "../src/lib/adaptive/types";
import { resolveFeatureFlags } from "../src/lib/featureFlags";
import { buildProfileView } from "../src/lib/profileView";
import type { ProfileDigest } from "../src/lib/profileTypes";
import { PIPELINE_STEPS } from "../src/lib/pipelineTypes";

const digest: ProfileDigest = {
  contextHash: "fixed-profile", version: "v1", generatedAt: "2026-08-19T00:00:00Z",
  core: { demographics: [], homeAndWork: [], household: ["孩子4岁"], occupation: [], financialPosture: [], healthConstraints: ["最近膝盖不适"], persistentPreferences: ["不喜欢拥挤", "没有车"] },
  traits: [], domains: [
    { name: "family", summary: "亲子", availableSignals: ["age"], recordCount: 1, retrievalKeys: ["family.children"] },
    { name: "health", summary: "行动能力", availableSignals: ["knee"], recordCount: 1, retrievalKeys: ["health.knee"] },
    { name: "transport", summary: "交通", availableSignals: ["car"], recordCount: 1, retrievalKeys: ["transport.car"] },
  ], salientSignals: [], conflicts: [],
};

describe("adaptive rollout smoke matrix", () => {
  it.each([
    ["周末带孩子玩一天，别太累", "recommendation"],
    ["下周去上海出差两天，帮我安排晚上时间，别跑太远", "planning"],
    ["这三个方案哪个更适合我？我不太在意最低价，但不想折腾", "decision"],
    ["给我解释一下债券久期，尽量让我快速理解", "information"],
    ["帮我写一个发给团队的项目延期说明", "creation"],
    ["分析这半年支出趋势，告诉我最值得关注的两个变化", "analysis"],
  ])("routes %s to %s without a model call", (query, family) => {
    expect(classifyQuery(query).taskFamily).toBe(family);
  });

  it("recalls profile constraints within the old digest budget and typical local latency", () => {
    buildProfileView({ query: "warmup", digest, deviceContext: {} });
    const started = performance.now();
    let view = buildProfileView({ query: "周末带孩子玩一天，别太累", digest, deviceContext: {} });
    for (let index = 0; index < 20; index += 1) view = buildProfileView({
        query: "周末带孩子玩一天，别太累",
        digest,
        deviceContext: { family: { children: [{ age: 4 }] }, health: { knee: "最近不适" }, transport: { car: false }, preferences: { crowd: "dislike" } },
      });
    const elapsed = (performance.now() - started) / 20;
    expect(view.selectedDetails.map((detail) => detail.ref)).toEqual(expect.arrayContaining(["family.children[0].age", "health.knee", "transport.car"]));
    expect(view.budget.profileViewChars).toBeLessThanOrEqual(view.budget.oldDigestChars);
    expect(elapsed).toBeLessThan(10);
  });

  it("keeps classification deterministic and typically below 2ms", () => {
    const started = performance.now();
    for (let index = 0; index < 500; index += 1) classifyQuery("这三个方案哪个更适合我？我不想折腾");
    expect((performance.now() - started) / 500).toBeLessThan(2);
  });

  it("keeps the frozen six-step order", () => {
    expect(PIPELINE_STEPS).toEqual(["intent_analysis", "evidence_resolution", "clarification", "context_enrichment", "card_plan_generate", "openui_generate"]);
  });

  it("isolates learned policies by taskFamily and selects the latest version", () => {
    const oldHints = emptyStepHints(); oldHints.openui_generate = "旧 recommendation hint";
    const newHints = emptyStepHints(); newHints.openui_generate = "新 recommendation hint";
    const policies: AdaptivePolicyEntry[] = [
      { id: "rec-v1", scope: "class", taskFamily: "recommendation", profileOverlay: "", stepHints: oldHints, version: 1, status: "stable", supportCount: 1, updatedAt: "2026-01-01" },
      { id: "rec-v2", scope: "class", taskFamily: "recommendation", profileOverlay: "", stepHints: newHints, version: 2, status: "stable", supportCount: 2, updatedAt: "2026-01-02" },
    ];
    expect(resolveEffectivePolicy({ classification: classifyQuery("推荐一个选择"), stablePolicies: policies, step: "openui_generate" }).stepHint).toContain("新 recommendation");
    expect(resolveEffectivePolicy({ classification: classifyQuery("分析支出趋势"), stablePolicies: policies, step: "openui_generate" }).stepHint).not.toContain("recommendation hint");
  });

  it("allows every adaptive/edit/reflection flag to fail closed independently", () => {
    const env = Object.fromEntries(["ADAPTIVE_QUERY_CLASSIFICATION", "ADAPTIVE_STEERING", "PROFILE_VIEW_V2", "WEB_FACTS_OPTIONAL", "OPENUI_CARD_EDIT", "OPENUI_ASSETS", "OPENUI_LOCAL_BINDINGS", "REFLECTION_ATTRIBUTION", "REFLECTION_GRADIENT", "GUARDED_AUTO_LEARN"].map((name) => [`NEXT_PUBLIC_${name}`, "false"]));
    expect(Object.values(resolveFeatureFlags(env)).every((value) => value === false)).toBe(true);
  });
});
