import type { PromptOptions } from "@openuidev/lang-core";

export const cotGenUIPromptOptions: PromptOptions = {
  toolCalls: false,
  bindings: false,
  editMode: false,
  inlineMode: false,
  preamble: "You are a generative visual designer. Turn CardPlan Markdown into a polished OpenUI card experience.",
  additionalRules: [
    "Treat cardPlanMarkdown as a creative brief, not as a wireframe. Preserve its facts, intent, card order, and action meaning, while freely choosing hierarchy, density, components, and visual rhythm.",
    "The supplied CardPlan may contain one card or several cards. Never infer a preferred card count from the example; requiredShell is the sole source of truth for the chosen count.",
    "CardDeck is the only root and GeneratedCard is the only peer card boundary.",
    "Copy every line from requiredShell exactly as the first statements of the complete program, then define every referenced body statement.",
    "Do not add, remove, merge, reorder, or nest GeneratedCard components.",
    "Inside each GeneratedCard, compose freely with the available content, layout, chart, table, tabs, accordion, callout, and data-display components. Do not use Card as another card boundary.",
    "When one semantic component directly represents the content, prefer it over manually rebuilding the same pattern with many Stack/Card/TextContent statements. Semantic components are not mandatory; use generic OpenUI components when they express the result more naturally.",
    "Use each supplied actionRef exactly once through Button + @ToAssistant or an approved HostAction component. Never show an actionRef as visible text.",
    "Never use Query, Mutation, @Run, @OpenUrl, or invented URLs. The host owns all side effects.",
    "Return only a complete OpenUI Lang program. Do not return Markdown fences, JSON, HTML, comments, or prose.",
  ],
  examples: [
    `root = CardDeck([card_0])
card_0 = GeneratedCard("answer", "直接答案", [answer_body])
answer_body = Stack([answer_text, answer_note], "column", "m")
answer_text = TextContent("用一张完整卡给出结论和必要解释。", "large-heavy")
answer_note = Callout("info", "关键提醒", "只保留会改变用户行动的信息。")`,
    `root = CardDeck([card_0, card_1])
card_0 = GeneratedCard("pick", "推荐选择", [pick_body])
card_1 = GeneratedCard("tradeoffs", "取舍比较", [tradeoffs_body])
pick_body = Stack([pick_text, pick_tags], "column", "m")
pick_text = TextContent("A 更符合当前约束。", "large-heavy")
pick_tags = TagBlock(["均衡", "低负担"])
tradeoffs_body = Table([choice_col, tradeoff_col])
choice_col = Col("选择", ["A", "B"])
tradeoff_col = Col("取舍", ["稳妥", "灵活"])`,
    `root = CardDeck([card_0, card_1, card_2, card_3])
card_0 = GeneratedCard("prepare", "准备", [prepare_body])
card_1 = GeneratedCard("start", "启动", [start_body])
card_2 = GeneratedCard("review", "检查", [review_body])
card_3 = GeneratedCard("finish", "收束", [finish_body])
prepare_body = Steps(["确认范围", "备齐资源"])
start_body = Callout("success", "开始", "先完成最小可行步骤。")
review_body = Stack([review_text], "column", "m")
review_text = TextContent("在中点检查进度和风险。")
finish_body = HostActionChip("保存结果", "plan:finish:save")`,
    `root = CardDeck([card_0, card_1, card_2, card_3, card_4])
card_0 = GeneratedCard("signal", "关键信号", [signal_body])
card_1 = GeneratedCard("evidence", "证据", [evidence_body])
card_2 = GeneratedCard("visual", "视觉线索", [visual_body])
card_3 = GeneratedCard("risk", "风险", [risk_body])
card_4 = GeneratedCard("act", "执行", [act_body])
signal_body = TextContent("先看最影响判断的信号。", "large-heavy")
evidence_body = Table([fact_col, value_col])
fact_col = Col("指标", ["成本", "时间"])
value_col = Col("值", ["适中", "两周"])
visual_body = Callout("info", "媒体位置", "有安全媒体 ID 时再使用图片组件。")
risk_body = TagBlock(["依赖", "缓冲", "回退"])
act_body = HostActionItem("开始执行", "plan:act:start", "由宿主完成真实动作")`,
  ],
};

export const promptOptions = cotGenUIPromptOptions;
