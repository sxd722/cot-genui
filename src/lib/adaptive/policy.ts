import { defaultHintFor } from "./defaultPolicies";
import { sanitizeProfileOverlay, sanitizeSteeringHint } from "./validation";
import type { AdaptivePolicyEntry, DecisionMode, EffectiveAdaptiveContext, QueryClassification } from "./types";
import type { PipelineStepName } from "../pipelineTypes";

const MODE_CLAUSE: Record<DecisionMode, string> = {
  compare: "当前是比较决策，突出真正改变选择的差异。",
  optimize: "当前是约束优化，优先满足硬约束再比较次要偏好。",
  verify: "当前是验证判断，区分已有证据、推断和未知。",
  execute: "当前偏执行，减少无关解释并突出可行动下一步。",
  reassure: "当前包含确认需求，先澄清真实风险和不确定性再给建议。",
  narrow_down: "当前要缩小候选，主动合并重复项并明确淘汰理由。",
  explore: "当前偏探索，提供有区分度的方向而不是过早收敛。",
  general: "",
};

export function resolveEffectivePolicy(args: {
  classification: QueryClassification;
  userKey?: string;
  stablePolicies: AdaptivePolicyEntry[];
  step: PipelineStepName;
}): EffectiveAdaptiveContext {
  const stable = args.stablePolicies.filter((policy) => policy.status === "stable");
  const selected = stable.find((policy) => policy.scope === "user-class" && policy.taskFamily === args.classification.taskFamily && !!args.userKey && policy.userKey === args.userKey)
    ?? stable.find((policy) => policy.scope === "class" && policy.taskFamily === args.classification.taskFamily)
    ?? stable.find((policy) => policy.scope === "global");
  const baseHint = selected?.stepHints[args.step] || defaultHintFor(args.classification.taskFamily, args.step);
  const modeClause = MODE_CLAUSE[args.classification.decisionMode];
  return {
    classification: args.classification,
    policyId: selected?.id ?? `default-${args.classification.taskFamily}`,
    policyVersion: selected?.version ?? 1,
    profileOverlay: sanitizeProfileOverlay(selected?.profileOverlay ?? ""),
    stepHint: sanitizeSteeringHint([baseHint, modeClause].filter(Boolean).join(" ")),
  };
}
