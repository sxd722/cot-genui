export const GENERAL_OPENUI_EXAMPLES = [
  `root = CardDeck([card_0], "auto")
card_0 = GeneratedCard("answer", "核心回答", [body], "editorial", "balanced")
body = Stack([lead, note], "column", "m")
lead = TextContent("先给出直接、完整的答案。", "large-heavy")
note = Callout("info", "补充", "只保留真正影响理解的信息。")`,
  `root = CardDeck([card_0, card_1], "auto")
card_0 = GeneratedCard("context", "当前判断", [context_body], "data", "compact")
card_1 = GeneratedCard("response", "建议动作", [response_body], "action", "balanced")
context_body = MetricRow([{label:"优先级",value:"高"},{label:"风险",value:"可控"}])
response_body = ActionPanel("继续", "选择一个安全动作", [confirm_action])
confirm_action = HostActionChip("确认", "plan:response:confirm")`,
];
