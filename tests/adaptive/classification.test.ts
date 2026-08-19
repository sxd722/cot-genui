import { describe, expect, it } from "vitest";
import { classifyQuery, refineClassification } from "../../src/lib/adaptive/classification";
import type { InferenceState } from "../../src/lib/pipelineTypes";

const state = (taskType: string, outcome: InferenceState["fulfillment"] extends infer T ? T : never): InferenceState => ({
  taskType,
  fulfillment: outcome,
  needsContext: false,
  slotRequirements: [], slots: [], conflicts: [], questions: [], assumptions: [],
});

describe("query classification", () => {
  it.each([
    ["周末带孩子去哪玩，别太累", "recommendation", "optimize"],
    ["帮我安排北京三日行程", "planning", "general"],
    ["A 和 B 哪个更适合我", "decision", "compare"],
    ["什么是债券久期", "information", "general"],
    ["帮我写一封离职邮件", "creation", "general"],
    ["帮我预约周五晚餐", "action", "execute"],
    ["分析一下这半年支出趋势", "analysis", "general"],
    ["我担心这次裁员，应该怎么办", "support", "reassure"],
  ])("classifies %s deterministically", (query, family, mode) => {
    expect(classifyQuery(query)).toMatchObject({ taskFamily: family, decisionMode: mode, source: "heuristic" });
    expect(classifyQuery(query)).toEqual(classifyQuery(query));
  });

  it("refines from the existing step-one state without changing a non-general mode", () => {
    const provisional = classifyQuery("帮我看看 A 还是 B");
    const refined = refineClassification(provisional, state("旅行规划", { outcome: "ideas", requiresFreshData: false, requiresLocation: false, requiresActionLink: false }));
    expect(refined).toMatchObject({ taskFamily: "planning", decisionMode: "compare", source: "step1-refined" });
  });
});
