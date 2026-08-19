import type { TaskFamily } from "@/lib/adaptive/types";

export interface GenerationEvalFixture {
  id: string;
  family: TaskFamily;
  query: string;
  expectedTopology: { minCards: number; maxCards: number };
  expectsMedia?: boolean;
  preferredCapabilities: string[];
}

export const GENERATION_EVAL_FIXTURES: GenerationEvalFixture[] = [
  { id: "info-weather", family: "information", query: "用一张卡告诉我明天出门是否需要带伞", expectedTopology: { minCards: 1, maxCards: 1 }, preferredCapabilities: ["callout", "metrics"] },
  { id: "info-concept", family: "information", query: "解释什么是机会成本，并给一个生活例子", expectedTopology: { minCards: 1, maxCards: 2 }, preferredCapabilities: ["editorial", "callout"] },
  { id: "info-event", family: "information", query: "整理这场活动的时间、地点和注意事项", expectedTopology: { minCards: 1, maxCards: 2 }, preferredCapabilities: ["metrics", "action"] },
  { id: "recommend-lunch", family: "recommendation", query: "推荐两种适合工作日的清淡午餐并说明区别", expectedTopology: { minCards: 1, maxCards: 2 }, expectsMedia: true, preferredCapabilities: ["recommendation", "comparison", "media"] },
  { id: "recommend-book", family: "recommendation", query: "根据我喜欢的科幻风格推荐三本入门读物", expectedTopology: { minCards: 1, maxCards: 3 }, expectsMedia: true, preferredCapabilities: ["recommendation", "media"] },
  { id: "recommend-hotel", family: "recommendation", query: "比较两个适合亲子入住的北京酒店方案", expectedTopology: { minCards: 2, maxCards: 3 }, expectsMedia: true, preferredCapabilities: ["comparison", "media", "action"] },
  { id: "plan-morning", family: "planning", query: "安排一个两小时的高效晨间流程", expectedTopology: { minCards: 1, maxCards: 2 }, preferredCapabilities: ["timeline", "metrics"] },
  { id: "plan-weekend", family: "planning", query: "规划上海两日周末行程，兼顾美食和休息", expectedTopology: { minCards: 2, maxCards: 5 }, expectsMedia: true, preferredCapabilities: ["timeline", "media", "action"] },
  { id: "plan-launch", family: "planning", query: "给小型产品发布制定四阶段执行计划", expectedTopology: { minCards: 2, maxCards: 4 }, preferredCapabilities: ["timeline", "metrics", "action"] },
  { id: "decision-phone", family: "decision", query: "在轻便和续航之间帮我选择一款通勤手机", expectedTopology: { minCards: 1, maxCards: 2 }, preferredCapabilities: ["comparison", "recommendation"] },
  { id: "decision-rent", family: "decision", query: "比较合租和整租对当前预算的影响", expectedTopology: { minCards: 2, maxCards: 3 }, preferredCapabilities: ["comparison", "metrics"] },
  { id: "decision-offer", family: "decision", query: "帮我权衡两个工作 offer 的长期发展", expectedTopology: { minCards: 2, maxCards: 4 }, preferredCapabilities: ["comparison", "table", "action"] },
  { id: "analysis-budget", family: "analysis", query: "分析这份月度预算的主要压力来源", expectedTopology: { minCards: 1, maxCards: 3 }, preferredCapabilities: ["metrics", "chart", "callout"] },
  { id: "analysis-sales", family: "analysis", query: "展示季度销售趋势和异常点", expectedTopology: { minCards: 1, maxCards: 3 }, preferredCapabilities: ["chart", "table"] },
  { id: "analysis-options", family: "analysis", query: "分析三个方案的成本、风险和收益", expectedTopology: { minCards: 2, maxCards: 4 }, preferredCapabilities: ["comparison", "metrics", "table"] },
  { id: "creation-invite", family: "creation", query: "制作一个简洁温暖的生日邀请信息卡", expectedTopology: { minCards: 1, maxCards: 1 }, expectsMedia: true, preferredCapabilities: ["editorial", "media"] },
  { id: "creation-brief", family: "creation", query: "把产品卖点整理成一页发布 brief", expectedTopology: { minCards: 1, maxCards: 2 }, preferredCapabilities: ["editorial", "metrics"] },
  { id: "creation-menu", family: "creation", query: "设计一组夏日饮品菜单介绍", expectedTopology: { minCards: 2, maxCards: 5 }, expectsMedia: true, preferredCapabilities: ["media", "recommendation"] },
  { id: "action-copy", family: "action", query: "给我一张可复制的会议跟进清单", expectedTopology: { minCards: 1, maxCards: 1 }, preferredCapabilities: ["action", "checklist"] },
  { id: "action-book", family: "action", query: "整理预订餐厅前需要确认的信息和操作入口", expectedTopology: { minCards: 1, maxCards: 2 }, preferredCapabilities: ["action", "callout"] },
  { id: "action-files", family: "action", query: "规划整理下载文件夹的安全步骤", expectedTopology: { minCards: 1, maxCards: 2 }, preferredCapabilities: ["timeline", "action"] },
  { id: "support-anxiety", family: "support", query: "我明天要面试很紧张，给我一个今晚可执行的准备方案", expectedTopology: { minCards: 1, maxCards: 2 }, preferredCapabilities: ["callout", "timeline"] },
  { id: "support-error", family: "support", query: "把常见登录失败原因整理成排查卡", expectedTopology: { minCards: 1, maxCards: 3 }, preferredCapabilities: ["timeline", "callout"] },
  { id: "support-choice", family: "support", query: "我不知道先学设计还是编程，帮我理清选择", expectedTopology: { minCards: 1, maxCards: 3 }, preferredCapabilities: ["comparison", "recommendation"] },
];
