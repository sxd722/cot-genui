/**
 * Skill Card DSL TypeScript 类型定义
 *
 * 从 SKILL-CARD-DSL-SPEC.md §3 (Complete TypeScript Wire Schema) 1:1 映射。
 * 这是 web 渲染引擎与鸿蒙 ArkUI renderer 共享的 wire contract。
 * 带字段名注释的，对应 spec 里 MUST/SHOULD 的语义约束。
 */

/** 协议版本常量（spec §2, §4） */
export const FLOW_VERSION = "card-flow-1" as const;
export const DSL_VERSION = "card-dsl-1" as const;

/** 卡片高层 UX 语义模板（spec §3 CardTemplate） */
export type CardTemplate =
  | "hero"
  | "summary"
  | "config"
  | "progress"
  | "confirm"
  | "preview"
  | "collection"
  | "actions"
  | "success"
  | "error";

/** Block 语义种类（spec §3 BlockKind，§7.2 详述） */
export type BlockKind =
  | "hero"
  | "text"
  | "entity-summary"
  | "key-value"
  | "choice"
  | "toggle"
  | "progress"
  | "status"
  | "text-preview"
  | "pager"
  | "list"
  | "illustration";

/** 值格式化器（spec §3 Formatter） */
export type Formatter =
  | "plain"
  | "bytes"
  | "percent"
  | "pageCounter"
  | "date"
  | "join";

/** 状态绑定（spec §6 Binding） */
export interface Binding {
  /** 必须带命名空间，如 "strings.selectedFileName" */
  path: string;
  /** 缺失或空时的显示回退 */
  fallback?: string;
  formatter?: Formatter;
}

/** 选项（spec §3 Option，choice block 用） */
export interface Option {
  label: string;
  value: string;
}

/** 动作种类（spec §3） */
export type GeneratedActionKind = "local" | "tool";

/** 按钮角色（spec §3） */
export type ActionRole = "primary" | "secondary" | "tertiary";

/** 派发目标（spec §3） */
export type Dispatch = "form" | "host";

/** 本地操作（spec §3 LocalOperation） */
export type LocalOperation =
  | "none"
  | "state.set"
  | "state.toggle"
  | "state.select"
  | "page.next"
  | "page.previous"
  | "list.toggle"
  | "session.reset";

/** 工具调用（spec §3 ToolCall） */
export interface ToolCall {
  adapterId: string;
  operation: string;
  inputBindings?: Record<string, Binding>;
  resultBindings?: Record<string, string>;
  outcomes: string[];
}

/** 动作（spec §3 Action，§8 详述） */
export interface Action {
  id: string;
  label: string;
  role?: ActionRole;
  kind: GeneratedActionKind;
  dispatch?: Dispatch;
  operation?: LocalOperation;
  /** 写入目标，带命名空间，如 "strings.outputFormat" */
  statePath?: string;
  /** state.set/state.select 写入的值（string） */
  stateValue?: string;
  /** 本地动作触发的事件；省略时用 action.id */
  event?: string;
  toolCall?: ToolCall;
  /** 外部链接工具的字面量 URL；不经过 state binding，便于渲染器直接生成安全的 <a>。 */
  externalUrl?: string;
  /** 用户可读确认语；不需要时省略 */
  confirmation?: string;
}

/** 卡片内容块（spec §3 Block，§7 详述） */
export interface Block {
  id: string;
  kind: BlockKind;
  title?: string;
  text?: string;
  detail?: string;
  /** 状态色调，如 "danger" */
  tone?: string;
  valueBinding?: Binding;
  secondaryBinding?: Binding;
  itemsBinding?: Binding;
  /** choice/toggle 等 block 关联的 actionId */
  actionId?: string;
  options?: Option[];
  maxItems?: number;
}

/** 卡片头（spec §3 Header，§7.1） */
export interface Header {
  skillName: string;
  stepLabel?: string;
  /** 建议单个 ASCII 字符 */
  iconText?: string;
}

/** 单张卡片（spec §3 Card） */
export interface Card {
  id: string;
  template: CardTemplate;
  header: Header;
  blocks: Block[];
  actions: Action[];
}

/** 初始状态（spec §3 InitialState，§6） */
export interface InitialState {
  strings?: Record<string, string>;
  numbers?: Record<string, number>;
  booleans?: Record<string, boolean>;
  stringLists?: Record<string, string[]>;
  numberLists?: Record<string, number[]>;
  objectsJson?: Record<string, string>;
}

/** 主题（spec §3 Theme） */
export interface Theme {
  preset?: string;
  accentToken?: string;
  surfaceToken?: string;
  dangerToken?: string;
}

/** CardDsl（spec §3） */
export interface CardDsl {
  dslVersion: typeof DSL_VERSION;
  theme?: Theme;
  startCardId: string;
  initialState?: InitialState;
  cards: Card[];
}

/** Flow transition（spec §3 FlowTransition，§5） */
export interface FlowTransition {
  event: string;
  targetCardId: string;
}

/** Flow 卡片（spec §3 FlowCard，§5.1） */
export interface FlowCard {
  id: string;
  purpose: string;
  template: CardTemplate;
  transitions: FlowTransition[];
}

/** CardFlow（spec §3） */
export interface CardFlow {
  flowVersion: typeof FLOW_VERSION;
  skillId: string;
  singleForm: true;
  startCardId: string;
  cards: FlowCard[];
}

/** 顶层交付物（spec §2，§3 CardArtifact） */
export interface CardArtifact {
  artifactId: string;
  flow: CardFlow;
  dsl: CardDsl;
}

/* ----------------------- Runtime 内部类型（非 wire contract） ----------------------- */

/** 运行时状态（spec §6 的六个命名空间，objectsJson 在 runtime 不用作可执行） */
export interface RuntimeState {
  strings: Record<string, string>;
  numbers: Record<string, number>;
  booleans: Record<string, boolean>;
  stringLists: Record<string, string[]>;
  numberLists: Record<string, number[]>;
  objectsJson: Record<string, string>;
}

/** 校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** 数据目录条目（spec §6.3） */
export interface DataCatalogEntry {
  path: string;
  type: "string" | "number" | "boolean" | "string[]" | "number[]";
  writable: boolean;
  usage: string;
}

/** 工具目录条目（spec §9） */
export interface ToolCatalogEntry {
  adapterId: string;
  operation: string;
  inputs: string[];
  outputs: string[];
  outcomes: string[];
}
