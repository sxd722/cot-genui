/**
 * 三个场景的 CardPlan IR —— 用于验证编译器 + 渲染引擎
 *
 * 每个场景尽量贴近真实需求，诚实包含 spec 暂不支持的能力（图片/图表/LLM），
 * 让编译器降级处理，观察实际渲染效果。
 */

import type { CardPlan } from "./modules";

/* ------------------------------------------------------------------ */
/*  场景 1：读书笔记                                                    */
/*  每张卡 = 一个章节的 summary/图片/注意点                              */
/*  点击章节项跳转 → 该章节 summary                                      */
/*  部分内容 infographic → 图表（降级）                                  */
/*  按钮：复制文字 / 保存 summary                                        */
/* ------------------------------------------------------------------ */

export const readingNotesPlan: CardPlan = {
  skillName: "深度工作·读书笔记",
  iconText: "R",
  reasoning:
    "全书4章节笔记。每章一张卡(概览+要点+图表)。章节列表可点击跳到对应章节详情。提供复制和保存操作。",
  cards: [
    {
      id: "book-overview",
      purpose: "全书概览",
      blocks: [
        {
          kind: "hero",
          title: "《深度工作》读书笔记",
          text: "Cal Newport · 4个章节 · 专注力训练手册",
        },
        {
          kind: "chart",
          title: "阅读进度",
          chartType: "progress-ring",
          valueFromSlot: "readProgress",
          value: "75",
          text: "已读 75%",
        },
      ],
      actions: [
        { id: "go-chapters", label: "查看章节", type: "navigate", targetCardId: "chapter-list", role: "primary" },
      ],
    },
    {
      id: "chapter-list",
      purpose: "章节列表（可点击跳转）",
      blocks: [
        {
          kind: "list",
          title: "章节目录",
          items: [
            { label: "第1章 · 深度工作是有价值的", onSelect: { writeTo: "selectedChapter", value: "第1章", thenGoTo: "chapter-detail" } },
            { label: "第2章 · 深度工作是稀缺的", onSelect: { writeTo: "selectedChapter", value: "第2章", thenGoTo: "chapter-detail" } },
            { label: "第3章 · 深度工作是有意义的", onSelect: { writeTo: "selectedChapter", value: "第3章", thenGoTo: "chapter-detail" } },
            { label: "第4章 · 准则：拥抱无聊", onSelect: { writeTo: "selectedChapter", value: "第4章", thenGoTo: "chapter-detail" } },
          ],
        },
      ],
      actions: [
        { id: "back-overview", label: "返回概览", type: "navigate", targetCardId: "book-overview", role: "secondary" },
      ],
    },
    {
      id: "chapter-detail",
      purpose: "选中章节的笔记详情",
      blocks: [
        {
          kind: "summary",
          title: "章节笔记",
          valueFromSlot: "selectedChapter",
          text: "核心论点：深度工作能力越来越稀缺，同时价值越来越高。",
          detail: "关键词：认知要求 · 非重复性 · 创造性",
        },
        {
          kind: "image",
          title: "章节配图",
          imageUrl: "https://example.com/ch1-diagram.png",
          text: "深度工作 vs 浅工作的价值对比图",
        },
        {
          kind: "infographic",
          title: "本章要点",
          chartType: "bullet-list",
          value: "• 深度工作创造新价值\n• 浅工作易被替代\n• 专注力需刻意训练",
        },
        {
          kind: "status",
          title: "注意点",
          text: "不要在无聊时立刻玩手机——让大脑学会忍受无聊，是深度工作的前提。",
          tone: "warning",
        },
      ],
      actions: [
        { id: "copy-note", label: "复制笔记", type: "copy", copyText: "深度工作是有价值的", role: "primary" },
        { id: "save-note", label: "保存", type: "save", role: "secondary" },
        { id: "back-list", label: "返回目录", type: "navigate", targetCardId: "chapter-list", role: "tertiary" },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  场景 2：PDF 文字识别（spec 原生场景）                                */
/*  选文件 → radio格式 → OCR → 预览 → 保存                              */
/* ------------------------------------------------------------------ */

export const pdfOcrPlan: CardPlan = {
  skillName: "PDF文字识别",
  iconText: "P",
  reasoning:
    "标准文件处理流程：选择文件→选择输出格式(MD/TXT)→执行OCR识别→预览结果→保存导出。每个工具动作对应 spec 能力目录。",
  cards: [
    {
      id: "select-source",
      purpose: "选择源文件",
      blocks: [
        {
          kind: "hero",
          title: "选择一个文档",
          text: "支持 PDF、图片、TXT 和 Markdown",
        },
        {
          kind: "summary",
          title: "当前文件",
          value: "尚未选择文件",
          detail: "点击下方按钮从文件管理器选择",
        },
      ],
      actions: [
        { id: "pick-file", label: "选择文件", type: "navigate", targetCardId: "choose-format", role: "primary" },
      ],
    },
    {
      id: "choose-format",
      purpose: "选择输出格式",
      blocks: [
        {
          kind: "choice",
          title: "输出格式",
          text: "选择识别结果的保存格式",
          options: ["Markdown", "TXT"],
          currentFromSlot: "outputFormat",
        },
        {
          kind: "toggle",
          title: "保留文档结构",
          text: "维持原文的段落和标题层级",
          currentFromSlot: "preserveStructure",
        },
      ],
      actions: [
        { id: "start-ocr", label: "开始识别", type: "navigate", targetCardId: "recognizing", role: "primary" },
        { id: "back-pick", label: "返回", type: "navigate", targetCardId: "select-source", role: "secondary" },
      ],
    },
    {
      id: "recognizing",
      purpose: "OCR识别中",
      blocks: [
        {
          kind: "progress",
          title: "正在识别文字",
          valueFromSlot: "progress",
          value: "45",
          text: "正在处理第3页/共8页",
        },
      ],
      actions: [
        { id: "view-result", label: "查看结果", type: "navigate", targetCardId: "preview-result", role: "primary" },
      ],
    },
    {
      id: "preview-result",
      purpose: "识别结果预览",
      blocks: [
        {
          kind: "summary",
          title: "识别完成",
          value: "共8页 · 12,450字符",
          detail: "Markdown格式",
        },
        {
          kind: "list",
          title: "预览（前5行）",
          itemsFromSlot: "previewLines",
        },
      ],
      actions: [
        { id: "save-file", label: "保存文件", type: "save", role: "primary" },
        { id: "copy-result", label: "复制全文", type: "copy", role: "secondary" },
        { id: "restart", label: "重新开始", type: "navigate", targetCardId: "select-source", role: "tertiary" },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  场景 3：股票跟踪                                                     */
/*  选股 → 股价 metric → 暴涨告警 → LLM行动建议                          */
/* ------------------------------------------------------------------ */

export const stockTrackerPlan: CardPlan = {
  skillName: "股票跟踪",
  iconText: "S",
  reasoning:
    "自选股管理：选择关注的股票→查看最新行情(股价/涨跌)→异常波动告警(红/绿)→LLM给出行动建议。涉及 metric 展示和卡片内 LLM（spec暂不支持，降级）。",
  cards: [
    {
      id: "watchlist-setup",
      purpose: "选择关注股票",
      blocks: [
        {
          kind: "hero",
          title: "我的自选股",
          text: "选择要跟踪的股票，实时监控行情",
        },
        {
          kind: "list",
          title: "推荐关注",
          items: [
            { label: "贵州茅台 (600519)", onSelect: { writeTo: "selectedStock", value: "贵州茅台", thenGoTo: "stock-detail" } },
            { label: "宁德时代 (300750)", onSelect: { writeTo: "selectedStock", value: "宁德时代", thenGoTo: "stock-detail" } },
            { label: "比亚迪 (002594)", onSelect: { writeTo: "selectedStock", value: "比亚迪", thenGoTo: "stock-detail" } },
          ],
        },
      ],
      actions: [
        { id: "view-all", label: "查看全部行情", type: "navigate", targetCardId: "market-overview", role: "primary" },
      ],
    },
    {
      id: "stock-detail",
      purpose: "选中股票详情",
      blocks: [
        {
          kind: "summary",
          title: "实时行情",
          valueFromSlot: "selectedStock",
          detail: "数据来源：REST API（模拟）",
        },
        {
          kind: "metric",
          title: "关键指标",
          metrics: [
            { label: "现价", value: 1689, unit: "元" },
            { label: "涨跌幅", value: 7, unit: "%" },
            { label: "成交量", value: 2, unit: "万手" },
          ],
        },
        {
          kind: "status",
          title: "⚠ 暴涨告警",
          text: "今日涨幅 7.2%，触及异常波动阈值",
          tone: "danger",
        },
      ],
      actions: [
        { id: "get-advice", label: "AI行动建议", type: "llm-call", role: "primary" },
        { id: "back-list", label: "返回列表", type: "navigate", targetCardId: "watchlist-setup", role: "secondary" },
      ],
    },
    {
      id: "market-overview",
      purpose: "大盘总览",
      blocks: [
        {
          kind: "metric",
          title: "大盘指数",
          metrics: [
            { label: "上证指数", value: 3289, unit: "" },
            { label: "深证成指", value: 10456, unit: "" },
          ],
        },
        {
          kind: "infographic",
          title: "今日板块热力图",
          chartType: "heatmap",
          value: "新能源 +3.2% | 白酒 +2.1% | 半导体 -1.5%",
        },
      ],
      actions: [
        { id: "back-watch", label: "返回自选", type: "navigate", targetCardId: "watchlist-setup", role: "primary" },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  场景汇总                                                           */
/* ------------------------------------------------------------------ */

export interface Scenario {
  id: string;
  label: string;
  description: string;
  plan: CardPlan;
}

export const scenarios: Scenario[] = [
  {
    id: "travel",
    label: "旅游规划",
    description: "景点列表可点击→详情（数据流 demo）",
    plan: {
      skillName: "北京亲子游",
      iconText: "B",
      reasoning: "景点列表点击→详情的数据流验证",
      cards: [
        {
          id: "overview",
          purpose: "行程概览",
          blocks: [
            { kind: "hero", title: "北京4天3晚亲子游", text: "一家三口·8月20日出发" },
            { kind: "summary", title: "出行人", value: "一家三口（含3岁女儿）", detail: "含3岁宝宝，需亲子友好安排" },
          ],
          actions: [{ id: "go-attractions", label: "查看景点", type: "navigate", targetCardId: "attractions" }],
        },
        {
          id: "attractions",
          purpose: "推荐景点（可点击查看详情）",
          blocks: [
            {
              kind: "list",
              title: "推荐景点",
              items: [
                { label: "故宫博物院", onSelect: { writeTo: "selectedSpot", value: "故宫", thenGoTo: "spot-detail" } },
                { label: "北京动物园", onSelect: { writeTo: "selectedSpot", value: "动物园", thenGoTo: "spot-detail" } },
                { label: "颐和园", onSelect: { writeTo: "selectedSpot", value: "颐和园", thenGoTo: "spot-detail" } },
              ],
            },
          ],
          actions: [{ id: "go-itinerary", label: "查看行程", type: "navigate", targetCardId: "itinerary" }],
        },
        {
          id: "spot-detail",
          purpose: "选中景点详情",
          blocks: [
            { kind: "summary", title: "景点详情", valueFromSlot: "selectedSpot", text: "预约信息、开放时间、亲子提示" },
            { kind: "status", title: "提示", text: "建议提前7天预约门票", tone: "warning" },
          ],
          actions: [{ id: "back-list", label: "返回列表", type: "navigate", targetCardId: "attractions", role: "secondary" }],
        },
        {
          id: "itinerary",
          purpose: "行程总览",
          blocks: [
            { kind: "list", title: "每日行程", items: [
              { label: "Day1: 抵达+前门大街" },
              { label: "Day2: 故宫+景山" },
              { label: "Day3: 动物园+颐和园" },
              { label: "Day4: 返程" },
            ] },
          ],
          actions: [{ id: "go-checklist", label: "行前清单", type: "navigate", targetCardId: "checklist" }],
        },
        {
          id: "checklist",
          purpose: "行前清单",
          blocks: [
            { kind: "list", title: "行前准备", items: [
              { label: "故宫门票提前7天预约" },
              { label: "携带轻便折叠推车" },
              { label: "防晒避暑用品" },
              { label: "保留弹性时间" },
            ] },
          ],
          actions: [{ id: "restart", label: "重新规划", type: "navigate", targetCardId: "overview", role: "secondary" }],
        },
      ],
    },
  },
  {
    id: "reading",
    label: "读书笔记",
    description: "章节summary/图片/图表/复制保存（图片图表降级）",
    plan: readingNotesPlan,
  },
  {
    id: "pdf",
    label: "PDF识别",
    description: "选文件→格式→OCR→预览→保存（spec原生）",
    plan: pdfOcrPlan,
  },
  {
    id: "stock",
    label: "股票跟踪",
    description: "选股→行情metric→暴涨告警→AI建议（LLM降级）",
    plan: stockTrackerPlan,
  },
];
