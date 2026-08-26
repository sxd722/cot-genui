import type { EpisodeEditRecord } from "@/learning/types";
import type { EditIntent } from "./types";

const RULES: Array<{ intent: EditIntent; pattern: RegExp; confidence: number }> = [
  { intent: "goal_correction", pattern: /你理解错|我不是想|重点不是|真正想要|我的意思是/i, confidence: 0.94 },
  { intent: "fact_correction", pattern: /事实不对|数字错|不是这个价格|不是\s*\d+岁|信息有误|改成\s*\d+/i, confidence: 0.91 },
  { intent: "priority_change", pattern: /更重要|不要强调|放前面|不是重点|更看重|优先/i, confidence: 0.83 },
  { intent: "interaction", pattern: /点击|滑动|展开|tabs?|下拉|hover|切换|交互/i, confidence: 0.9 },
  { intent: "layout", pattern: /放左边|放右边|上下|横向|间距|对齐|卡片太长|换位置|布局/i, confidence: 0.88 },
  { intent: "visual", pattern: /颜色|字号|更醒目|badge|阴影|圆角|图片更大|高亮|视觉/i, confidence: 0.88 },
  { intent: "content_add", pattern: /增加|补充|加上|遗漏|缺少/i, confidence: 0.76 },
  { intent: "content_remove", pattern: /删除|去掉|移除|不要这个/i, confidence: 0.78 },
  { intent: "card_structure", pattern: /拆成.*卡|合并.*卡|卡片结构|单独一张卡/i, confidence: 0.82 },
];

export function inferEditIntentHeuristic(edit: EpisodeEditRecord): {
  intent: EditIntent;
  confidence: number;
  semanticCorrection: boolean;
} {
  return inferFeedbackIntentHeuristic(edit.instruction);
}

export function inferFeedbackIntentHeuristic(rawText: string): {
  intent: EditIntent;
  confidence: number;
  semanticCorrection: boolean;
} {
  const text = rawText.trim();
  const match = RULES.find((rule) => rule.pattern.test(text));
  const intent = match?.intent ?? "content_rewrite";
  const semanticCorrection = ["goal_correction", "fact_correction", "priority_change", "content_add", "content_remove", "card_structure"].includes(intent)
    || /约束|理解|遗漏|事实|不是|必须|应该是/i.test(text);
  return { intent, confidence: match?.confidence ?? 0.62, semanticCorrection };
}

