import { PIPELINE_STEPS, type PipelineStepName } from "../pipelineTypes";
import type { StepHintMap, TaskFamily } from "./types";

export const GLOBAL_STEP_HINTS: StepHintMap = {
  intent_analysis: "除了建立槽位，也保留用户原始请求中无法被槽位充分表达的隐含目标、成功标准和负向偏好。",
  evidence_resolution: "除槽位直接证据外，也检查会改变排序、风险判断、体验偏好或最终选择的侧面证据。",
  clarification: "只询问真正可能改变最终结果的阻塞性不确定项，不追求字段形式上的完整。",
  context_enrichment: "汇总前重新对照原始意图，检查是否遗漏成功标准、禁忌、体验诉求或关键约束。",
  card_plan_generate: "围绕用户最终要完成的事情组织卡片，不按槽位或数据来源机械拆卡。",
  openui_generate: "把 CardPlan Markdown 当设计 brief，优先突出用户真正关心的结果、决策和操作路径。",
};

const CLASS_HINT_OVERRIDES: Partial<Record<TaskFamily, Partial<StepHintMap>>> = {
  recommendation: {
    intent_analysis: "优先识别真正会改变推荐排序的约束、隐含体验目标和不要什么。",
    card_plan_generate: "把候选压缩成可决策的少量选择，突出取舍而不是堆砌资料。",
    openui_generate: "让推荐卡一眼可比较，主要差异、理由和下一步应比背景说明更突出。",
  },
  planning: { card_plan_generate: "按用户实际执行顺序组织计划，显式处理时间、依赖和缓冲。" },
  decision: { card_plan_generate: "围绕真正改变结论的权衡维度组织选择，并标出代价。" },
  information: { context_enrichment: "区分确定事实、合理解释和仍未知的信息，避免过度延伸。" },
  creation: { openui_generate: "让产物本身成为视觉中心，背景说明保持克制。" },
  action: { openui_generate: "突出安全、明确且可逆的下一步动作，减少与执行无关的信息。" },
  analysis: { context_enrichment: "保留关键证据、时间范围和不确定性，避免把相关性写成因果。" },
  support: { clarification: "先确认真正风险和用户最担心的结果，避免用大量问题增加负担。" },
};

export function defaultHintFor(family: TaskFamily, step: PipelineStepName): string {
  return CLASS_HINT_OVERRIDES[family]?.[step] ?? GLOBAL_STEP_HINTS[step];
}

export function emptyStepHints(): StepHintMap {
  return Object.fromEntries(PIPELINE_STEPS.map((step) => [step, ""])) as StepHintMap;
}
