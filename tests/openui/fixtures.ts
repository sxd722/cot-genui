import type { CardPlan } from "../../src/dsl/modules";

export const sampleCardPlan: CardPlan = {
  skillName: "周末灵感",
  iconText: "✨",
  reasoning: "轻松、有重点，并给用户一个自然的下一步。",
  cards: [
    {
      id: "overview/first",
      purpose: "先看方向",
      blocks: [{ kind: "hero", title: "推荐 A", text: "整体最均衡" }],
    },
    {
      id: "compare",
      purpose: "比较差异",
      blocks: [{ kind: "metric", metrics: [{ label: "预算", value: 800, unit: "元" }] }],
      actions: [{ id: "details", label: "查看详情", type: "external-link", link: "https://example.com", role: "primary" }],
    },
    {
      id: "next",
      purpose: "继续行动",
      blocks: [{ kind: "summary", text: "确认后即可继续" }],
      actions: [{ id: "copy", label: "复制摘要", type: "copy", copyText: "摘要" }],
    },
  ],
};

export const sixCardPlan: CardPlan = {
  ...sampleCardPlan,
  skillName: "六卡决策面板",
  cards: [
    ...sampleCardPlan.cards,
    {
      id: "timeline",
      purpose: "安排节奏",
      blocks: [{ kind: "list", title: "时间线", items: [{ label: "上午", detail: "先处理高优先级事项" }, { label: "下午", detail: "留出机动时间" }] }],
    },
    {
      id: "risk",
      purpose: "识别风险",
      blocks: [{ kind: "progress", title: "准备度", value: "72%", detail: "主要缺口是确认执行窗口" }],
      actions: [{ id: "confirm", label: "确认窗口", type: "llm-call" }],
    },
    {
      id: "summary",
      purpose: "收束方案",
      blocks: [{ kind: "summary", title: "建议", text: "先按均衡方案推进，再根据实时反馈调整。" }],
      actions: [{ id: "save", label: "保存方案", type: "copy", copyText: "均衡方案" }],
    },
  ],
};

export function simpleTwoCardPlan(): CardPlan {
  return {
    skillName: "双卡比较",
    reasoning: "结论和取舍分别表达。",
    cards: [
      { id: "a", purpose: "结论", blocks: [{ kind: "summary", text: "优先 A" }] },
      { id: "b", purpose: "取舍", blocks: [{ kind: "text", text: "B 更灵活" }] },
    ],
  };
}
