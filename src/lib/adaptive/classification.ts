import type { InferenceState } from "../pipelineTypes";
import {
  DECISION_MODES,
  TASK_FAMILIES,
  type DecisionMode,
  type QueryClassification,
  type TaskFamily,
} from "./types";

type WeightedTerms = Record<string, { exact?: string[]; strong?: string[]; weak?: string[] }>;

const FAMILY_TERMS: WeightedTerms = {
  recommendation: { exact: ["吃什么", "买什么", "去哪", "哪个好", "带孩子玩"], strong: ["推荐", "适合", "哪家", "游玩", "周末去哪", "recommend", "suggest"], weak: ["选择", "候选", "玩"] },
  planning: { exact: ["行程安排"], strong: ["计划", "安排", "行程", "日程", "路线", "方案", "itinerary", "schedule"], weak: ["plan"] },
  decision: { exact: ["选哪个", "哪个更适合", "是否应该", "值不值"], strong: ["比较", "对比", "还是", "compare", " vs "], weak: ["哪个", "权衡"] },
  information: { exact: ["什么是", "怎么回事"], strong: ["解释", "了解", "信息", "explain"], weak: ["what", "how"] },
  creation: { exact: ["写一个", "做一个"], strong: ["生成", "设计", "创作", "draft", "create", "design"], weak: ["写", "制作"] },
  action: { exact: ["帮我订", "帮我预约"], strong: ["预订", "预约", "下单", "购买", "发送", "打开", "book", "reserve", "buy", "send"], weak: ["执行"] },
  analysis: { exact: ["分析一下"], strong: ["分析", "趋势", "原因", "评估", "复盘", "analyze", "trend", "evaluate"], weak: ["数据"] },
  support: { exact: ["怎么办", "给我建议", "帮我判断"], strong: ["我担心", "我不确定", "reassure", "advice"], weak: ["焦虑", "安心"] },
};

const MODE_TERMS: Record<Exclude<DecisionMode, "general">, string[]> = {
  compare: ["比较", "对比", "哪个", " vs ", "还是"],
  optimize: ["最省", "最优", "更快", "更便宜", "预算", "限制", "不要太", "尽量", "别太"],
  verify: ["确认", "是否真的", "靠谱", "对不对", "验证"],
  execute: ["帮我订", "下单", "预约", "发送", "购买"],
  reassure: ["担心", "焦虑", "安心", "我这样想对吗"],
  narrow_down: ["筛选", "缩小", "从这些里", "候选", "只留"],
  explore: ["有什么", "推荐一些", "灵感", "随便看看"],
};

function scoreTerms(text: string, terms: WeightedTerms[string]): number {
  return (terms.exact ?? []).filter((term) => text.includes(term)).length * 3
    + (terms.strong ?? []).filter((term) => text.includes(term)).length * 2
    + (terms.weak ?? []).filter((term) => text.includes(term)).length;
}

export function classifyQuery(query: string): QueryClassification {
  const text = ` ${query.toLowerCase().trim()} `;
  const ranked = Object.entries(FAMILY_TERMS)
    .map(([family, terms]) => ({ family: family as TaskFamily, score: scoreTerms(text, terms) }))
    .sort((left, right) => right.score - left.score || TASK_FAMILIES.indexOf(left.family) - TASK_FAMILIES.indexOf(right.family));
  const top = ranked[0] ?? { family: "general" as const, score: 0 };
  const margin = Math.max(0, top.score - (ranked[1]?.score ?? 0));
  const mode = (Object.entries(MODE_TERMS) as Array<[Exclude<DecisionMode, "general">, string[]]>)
    .map(([candidate, terms]) => ({ candidate, score: terms.filter((term) => text.includes(term)).length }))
    .sort((left, right) => right.score - left.score || DECISION_MODES.indexOf(left.candidate) - DECISION_MODES.indexOf(right.candidate))[0];
  return {
    taskFamily: top.score > 0 ? top.family : "general",
    decisionMode: mode?.score ? mode.candidate : "general",
    confidence: top.score > 0 ? Math.min(0.92, 0.45 + top.score * 0.08 + margin * 0.05) : 0.5,
    source: "heuristic",
  };
}

export function refineClassification(provisional: QueryClassification, state: InferenceState): QueryClassification {
  const task = state.taskType.toLowerCase();
  let taskFamily = provisional.taskFamily;
  if (state.fulfillment?.outcome === "actionable" && /购买|预约|预订|发送|执行|下单/.test(task)) taskFamily = "action";
  else if (/规划|行程|安排|计划/.test(task)) taskFamily = "planning";
  else if (/推荐|选择|餐饮|旅行目的地|目的地/.test(task)) taskFamily = "recommendation";
  else if (/比较|决策|权衡/.test(task)) taskFamily = "decision";
  else if (/分析|趋势|评估/.test(task)) taskFamily = "analysis";
  else if (/写作|创作|设计/.test(task)) taskFamily = "creation";
  return {
    taskFamily,
    decisionMode: state.fulfillment?.outcome === "actionable" && provisional.decisionMode === "general"
      ? "execute"
      : provisional.decisionMode,
    confidence: Math.min(0.96, provisional.confidence + (taskFamily === provisional.taskFamily ? 0.03 : 0.08)),
    source: "step1-refined",
  };
}

export function isQueryClassification(value: unknown): value is QueryClassification {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<QueryClassification>;
  return TASK_FAMILIES.includes(item.taskFamily as TaskFamily)
    && DECISION_MODES.includes(item.decisionMode as DecisionMode)
    && typeof item.confidence === "number"
    && Number.isFinite(item.confidence)
    && (item.source === "heuristic" || item.source === "step1-refined");
}
