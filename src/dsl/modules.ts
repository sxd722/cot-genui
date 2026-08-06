/**
 * Card Plan IR（中间表示）—— 模型在第 7 步产出的"卡片设计意图"
 *
 * 设计原则：
 * 1. 语义化：字段描述"是什么/做什么"，不描述 DSL 语法
 * 2. 能表达数据流：列表项点击可写状态、驱动后续卡片（onSelect）
 * 3. 领先 spec：可描述图片/图表/外链/LLM调用等 spec 暂不支持的能力，
 *    编译器诚实降级，不报错
 *
 * 这是模型与编译器之间的契约：模型输出 CardPlan，编译器编译成 CardArtifact。
 */

/* ------------------------------------------------------------------ */
/*  顶层                                                               */
/* ------------------------------------------------------------------ */

/** 模型在第 7 步产出的完整卡片计划 */
export interface CardPlan {
  /** 卡片组标题，如 "北京亲子游" */
  skillName: string;
  /** 图标字符（单个 ASCII/emoji），编译进 header.iconText */
  iconText?: string;
  /** 模型的设计思路（给诊断/调试用） */
  reasoning: string;
  /** 卡片序列（顺序即默认展示顺序） */
  cards: CardNode[];
}

/* ------------------------------------------------------------------ */
/*  卡片节点                                                           */
/* ------------------------------------------------------------------ */

export interface CardNode {
  /** 稳定 ID，snake_case，如 "attractions" */
  id: string;
  /** 这张卡的用途说明 */
  purpose: string;
  /** 展示内容块 */
  blocks: IRBlock[];
  /** 可选的操作（按钮）；纯展示卡可为空或省略 */
  actions?: IRAction[];
}

/* ------------------------------------------------------------------ */
/*  内容块（语义化，不受 DSL BlockKind 限制）                          */
/* ------------------------------------------------------------------ */

/**
 * IR 的 block kind 比 DSL 更丰富。
 * 编译器负责映射：能映射的映射，不能的降级 + 标记。
 */
export type IRBlockKind =
  | "hero" // 大标题说明
  | "summary" // 主副摘要
  | "list" // 列表（项可带点击动作）
  | "progress" // 进度
  | "status" // 状态/告警
  | "metric" // 数值指标
  | "choice" // 互斥选项
  | "toggle" // 布尔开关
  // —— 以下领先 spec，编译器当前降级处理 ——
  | "image" // 图片（spec 无 image block）
  | "chart" // 图表（spec 无 chart block）
  | "infographic"; // 信息图（spec 无）

export interface IRBlock {
  kind: IRBlockKind;
  title?: string;
  text?: string;
  /** 细节补充 */
  detail?: string;
  /** 状态色调：info/success/warning/danger */
  tone?: string;

  // —— 内容来源（三选一，编译器优先级：value > valueFromSlot > items/itemsFromSlot）——
  /** 直接给文本值 */
  value?: string;
  /** 引用前序 slot.name，编译时查 slots 取值放进 initialState */
  valueFromSlot?: string;

  // —— 列表专用 ——
  /** 直接给列表项（每项可带点击动作） */
  items?: IRListItem[];
  /** 引用 list 型 slot.name */
  itemsFromSlot?: string;

  // —— choice/toggle 专用 ——
  /** choice 的选项（编译成 options + state.select） */
  options?: string[];
  /** 当前选中值的 slot 引用 */
  currentFromSlot?: string;

  // —— metric 专用 ——
  /** 指标项 [{label, value, unit}] */
  metrics?: IRMetric[];

  // —— image/chart 领先字段（编译器降级）——
  imageUrl?: string;
  chartType?: string;

  // —— 缺失信息（系统自动补齐）——
  missingInfo?: IRMissingInfo;
}

/** 缺失信息声明（系统自动补齐） */
export interface IRMissingInfo {
  /** 搜索/推理查询语句 */
  query: string;
  /** 补齐来源 */
  source: "web_search" | "llm_reasoning";
  /** 补齐前的占位文本 */
  fallback?: string;
}

/** 列表项（核心：可带 onSelect 表达数据流） */
export interface IRListItem {
  label: string;
  /** 点击这一项发生什么——这是动态数据流的来源 */
  onSelect?: IRSelectFlow;
}

/** 选择流：点击项 → 写状态 → 可选跳卡 */
export interface IRSelectFlow {
  /** 写入的 state key（不带命名空间，编译器加 strings. 前缀），如 "selectedSpot" */
  writeTo: string;
  /** 写入的值 */
  value: string;
  /** 写完后跳到哪张卡（省略则不跳转，仅更新状态） */
  thenGoTo?: string;
}

/** 指标项 */
export interface IRMetric {
  label: string;
  value: number;
  unit?: string;
}

/* ------------------------------------------------------------------ */
/*  操作（按钮）                                                       */
/* ------------------------------------------------------------------ */

export type IRActionType =
  | "navigate" // 跳到另一张卡（编译成 local + event + transition）
  | "select" // 选择某值写入状态（choice 场景）
  | "toggle" // 切换布尔
  | "external-link" // 打开外链（编译成 tool，需 adapter 支持）
  | "confirm" // 确认/提交（编译成 local + 可选 event）
  | "copy" // 复制文字（编译成 tool: system.clipboard.write）
  | "save" // 保存文件（编译成 tool: system.file.save）
  | "pick-file" // 选择文件（编译成 tool: system.file.pick）
  | "ocr" // 文字识别（编译成 tool: document.text.extract / vision.ocr）
  | "llm-call" // 卡片内 LLM 调用（编译成 tool: ai.llm）
  | "tool"; // 通用工具调用（直接指定 adapterId/operation）

export interface IRAction {
  id: string;
  label: string;
  type: IRActionType;
  /** navigate: 目标卡 ID */
  targetCardId?: string;
  /** select: 写入的 state key */
  writeTo?: string;
  /** select: 写入的值 */
  writeValue?: string;
  /** external-link: 链接 */
  link?: string;
  /** copy: 要复制的文字（可引用 slot） */
  copyText?: string;
  /** 角色：主/次/三级（影响按钮样式） */
  role?: "primary" | "secondary" | "tertiary";
}

/* ------------------------------------------------------------------ */
/*  编译器诊断（编译时产出，供 UI 展示）                                */
/* ------------------------------------------------------------------ */

/** 编译过程中的降级/不支持提示 */
export interface CompileNotice {
  level: "downgraded" | "unsupported" | "info";
  message: string;
  /** 相关的 cardId / block / action */
  location?: string;
}

/** 编译结果 */
export interface CompileResult {
  artifact: import("./types").CardArtifact;
  notices: CompileNotice[];
}
