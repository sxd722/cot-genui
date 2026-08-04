/**
 * LLM Structured Output 的 JSON Schema 定义
 *
 * 这里用的是 OpenAI 兼容接口的 json_schema response_format。
 * 注意 OpenAI structured output 要求 schema 顶层有 "type": "object"
 * 且设置 "additionalProperties": false，所有嵌套对象同理。
 */

/** 单个推理步骤（7 步管线之一） */
export const stepSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description:
        "步骤标识符: surface_parse | sufficiency_check | context_mining | conflict_detection | triage | clarifying_questions | generate",
    },
    reasoning: {
      type: "string",
      description: "这一步的自然语言推理过程",
    },
    outputs: {
      type: "object",
      description: "这一步的结构化产出，字段因步骤而异",
      additionalProperties: true,
    },
  },
  required: ["name", "reasoning", "outputs"],
  additionalProperties: false,
} as const;

/** 槽位推断结果 */
export const slotSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "槽位键名，如 travelers / origin" },
    value: {
      type: "string",
      description: "推断出的取值；无法推断时留空",
    },
    evidence: {
      type: "string",
      description: "推断推理链：为什么从证据得到这个值",
    },
    source_record: {
      type: "string",
      description: "证据来源记录，引用 device_context 中的具体字段/值",
    },
    confidence: {
      type: "number",
      description: "置信度 0~1",
    },
    status: {
      type: "string",
      enum: ["high", "medium", "low", "conflict"],
      description: "分流状态：高/中/低置信，或冲突",
    },
  },
  required: [
    "name",
    "value",
    "evidence",
    "source_record",
    "confidence",
    "status",
  ],
  additionalProperties: false,
} as const;

/** 冲突记录 */
export const conflictSchema = {
  type: "object",
  properties: {
    slot: { type: "string" },
    evidence_a: { type: "string", description: "证据 A 及其指向的值" },
    evidence_b: { type: "string", description: "证据 B 及其指向的值" },
    note: { type: "string", description: "冲突说明" },
  },
  required: ["slot", "evidence_a", "evidence_b", "note"],
  additionalProperties: false,
} as const;

/** 消歧问题 */
export const questionSchema = {
  type: "object",
  properties: {
    question: { type: "string" },
    reason: {
      type: "string",
      description: "为什么必须问这个问题",
    },
    blocking: {
      type: "boolean",
      description: "是否阻塞核心输出",
    },
  },
  required: ["question", "reason", "blocking"],
  additionalProperties: false,
} as const;

/** 单张方案卡片 */
export const planCardSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "卡片标题" },
    body: { type: "string", description: "卡片正文摘要（1-2句）" },
    tag: {
      type: "string",
      description: "分类标签，决定卡片图形化样式：交通/住宿/餐饮/行程/提醒/预算/购物/总览",
    },
    icon: { type: "string", description: "一个 emoji 图标" },
    highlight: {
      type: "string",
      description: "最关键的一句信息/亮点（醒目展示）",
    },
    // 清单型：餐饮/行程/提醒/购物 等，渲染为可勾选清单
    items: {
      type: "array",
      items: { type: "string" },
      description: "清单条目（每项可被用户勾选标记完成）",
    },
    // 指标型：预算 等，渲染为数值条
    metrics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "指标名，如 高铁/住宿/餐饮" },
          value: { type: "number", description: "数值（金额/数量）" },
          unit: { type: "string", description: "单位，如 元/天/人" },
        },
        required: ["label", "value", "unit"],
        additionalProperties: false,
      },
      description: "数值指标（用于渲染比例条/对比图）",
    },
    // 时间型：行程/交通 等，渲染为时间轴
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          time: { type: "string", description: "时间点或第几天，如 Day1/08:00" },
          event: { type: "string", description: "该时段安排" },
        },
        required: ["time", "event"],
        additionalProperties: false,
      },
      description: "时间轴节点（用于渲染行程时间线）",
    },
  },
  required: ["title", "body", "tag", "icon"],
  additionalProperties: false,
} as const;

/** 最终结果 */
export const resultSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "一句话方案总结",
    },
    cards: {
      type: "array",
      items: planCardSchema,
      description: "5-8 张方案卡片",
    },
    assumptions: {
      type: "array",
      items: { type: "string" },
      description: "替用户做的所有假设清单，供用户确认或纠正",
    },
    inferred_profile: {
      type: "string",
      description: "对用户的画像总结（基于推断）",
    },
  },
  required: ["summary", "cards", "assumptions"],
  additionalProperties: false,
} as const;

/** 完整输出的 JSON Schema */
export const inferResponseSchema = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: stepSchema,
      description: "7 步消歧管线的逐步推理",
    },
    slots: {
      type: "array",
      items: slotSchema,
      description: "所有槽位的最终推断状态",
    },
    conflicts: {
      type: "array",
      items: conflictSchema,
      description: "检测到的冲突",
    },
    clarifying_questions: {
      type: "array",
      items: questionSchema,
      description: "必须向用户澄清的问题",
    },
    result: resultSchema,
  },
  required: [
    "steps",
    "slots",
    "conflicts",
    "clarifying_questions",
    "result",
  ],
  additionalProperties: false,
} as const;

/* ----------------------- TypeScript 类型（前端用） ----------------------- */

export interface InferStep {
  name: string;
  reasoning: string;
  outputs: Record<string, unknown>;
}

export interface InferSlot {
  name: string;
  value: string;
  evidence: string;
  source_record: string;
  confidence: number;
  status: "high" | "medium" | "low" | "conflict";
  /** 分步模式下模型可能返回额外字段 */
  [key: string]: unknown;
}

export interface InferConflict {
  slot: string;
  evidence_a: string;
  evidence_b: string;
  note: string;
  /** 分步模式下模型可能返回不同字段名（description/resolution_hint 等） */
  [key: string]: unknown;
}

export interface InferQuestion {
  question: string;
  reason: string;
  blocking: boolean;
  /** 候选答案（2-4 个），供用户一键选择 */
  options?: string[];
  /** 分步模式下模型可能返回额外字段 */
  [key: string]: unknown;
}

/** 单张方案卡片 */
/** 指标（预算等） */
export interface CardMetric {
  label: string;
  value: number;
  unit: string;
}

/** 时间轴节点（行程等） */
export interface CardTimelineNode {
  time: string;
  event: string;
}

export interface InferPlanCard {
  title: string;
  body: string;
  tag: string;
  icon: string;
  /** 亮点信息（醒目展示） */
  highlight?: string;
  /** 清单条目（可勾选） */
  items?: string[];
  /** 数值指标（比例条） */
  metrics?: CardMetric[];
  /** 时间轴 */
  timeline?: CardTimelineNode[];
  /** 允许额外字段 */
  [key: string]: unknown;
}

export interface InferResult {
  summary: string;
  cards: InferPlanCard[];
  assumptions: string[];
  /** 画像总结（可选，旧字段兼容） */
  inferred_profile?: string;
  /** 允许额外字段 */
  [key: string]: unknown;
}

export interface InferResponse {
  steps: InferStep[];
  slots: InferSlot[];
  conflicts: InferConflict[];
  clarifying_questions: InferQuestion[];
  result: InferResult;
}
