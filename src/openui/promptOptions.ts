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
    "Use each supplied actionRef exactly once through Button + @ToAssistant or an approved HostAction component. Never show an actionRef as visible text.",
    "Never use Query, Mutation, @Run, @OpenUrl, or invented URLs. The host owns all side effects.",
    "Return only a complete OpenUI Lang program. Do not return Markdown fences, JSON, HTML, comments, or prose.",
  ],
  examples: [
    `root = CardDeck([card_0, card_1, card_2])
card_0 = GeneratedCard("overview", "方向概览", [overview_body])
card_1 = GeneratedCard("comparison", "关键比较", [comparison_body])
card_2 = GeneratedCard("next", "下一步", [next_body])
overview_body = Stack([hero, tags], "column", "m")
hero = TextContent("优先选择最贴合当前节奏的方案。", "large-heavy")
tags = TagBlock(["轻量", "可执行", "有重点"])
comparison_body = Stack([comparison_callout, comparison_table], "column", "m")
comparison_callout = Callout("info", "设计提示", "用对比而不是堆叠长文突出差异。")
comparison_table = Table([option_col, reason_col])
option_col = Col("方案", ["A", "B"])
reason_col = Col("适合原因", ["整体平衡", "更有余量"])
next_body = Stack([next_text, next_actions], "column", "m")
next_text = TextContent("选择一个动作继续推进。")
next_actions = HostActionMenu([details_item, copy_item], "继续探索")
details_item = HostActionItem("查看详情", "plan:next:details", "打开宿主提供的安全详情")
copy_item = HostActionItem("复制摘要", "plan:next:copy")`,
  ],
};

export const promptOptions = cotGenUIPromptOptions;
