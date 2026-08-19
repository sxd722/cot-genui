export const ANALYSIS_OPENUI_EXAMPLES = [
  `root = CardDeck([card_0], "auto")
card_0 = GeneratedCard("signals", "关键指标", [body], "data", "balanced")
body = Stack([metrics, trend, note], "column", "m")
metrics = MetricRow([{label:"本期",value:"128"},{label:"变化",value:"+12%"}])
trend = LineChart(["一月","二月","三月"],[trend_series])
trend_series = Series("趋势",[98,114,128])
note = Callout("info", "解释", "增长主要来自最近一个周期。")`,
  `root = CardDeck([card_0, card_1], "auto")
card_0 = GeneratedCard("evidence", "证据", [evidence_body], "data", "compact")
card_1 = GeneratedCard("tradeoff", "方案比较", [tradeoff_body], "comparison", "balanced")
evidence_body = Table([metric_col, value_col])
metric_col = Col("指标", ["成本", "周期"])
value_col = Col("当前值", ["¥800", "14 天"])
tradeoff_body = ComparisonGrid([{title:"方案 A",rows:[{label:"风险",value:"低"}]},{title:"方案 B",rows:[{label:"速度",value:"快"}]}])`,
];
