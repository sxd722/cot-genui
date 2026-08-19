export const PLANNING_OPENUI_EXAMPLES = [
  `root = CardDeck([card_0], "auto")
card_0 = GeneratedCard("routine", "两小时流程", [body], "timeline", "balanced")
body = Timeline([{title:"准备",detail:"清空干扰",meta:"10 分钟"},{title:"专注",detail:"完成最重要任务",meta:"80 分钟"},{title:"收束",detail:"记录下一步",meta:"30 分钟"}])`,
  `root = CardDeck([card_0, card_1, card_2, card_3], "deck")
card_0 = GeneratedCard("prepare", "准备", [prepare_body], "timeline", "compact")
card_1 = GeneratedCard("execute", "执行", [execute_body], "timeline", "balanced")
card_2 = GeneratedCard("check", "检查", [check_body], "data", "compact")
card_3 = GeneratedCard("close", "收束", [close_body], "action", "compact")
prepare_body = Steps([prepare_scope, prepare_resources])
prepare_scope = StepsItem("确认范围", "锁定目标和边界")
prepare_resources = StepsItem("备齐资源", "检查依赖和输入")
execute_body = Timeline([{title:"启动"},{title:"推进"},{title:"缓冲"}])
check_body = MetricRow([{label:"完成度",value:"75%"},{label:"余量",value:"1 天"}])
close_body = ActionPanel("保存计划", "交给宿主完成", [save_action])
save_action = HostActionChip("保存", "plan:close:save")`,
];
