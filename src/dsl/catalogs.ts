/**
 * 数据目录 + 工具目录（spec §6.3 数据目录、§9 工具能力目录）
 *
 * spec 原始目录是为 PDF MVP 定制的。这里按"通用基础 + 场景扩展"分层组织，
 * 使 DSL 可服务于任意场景——新增场景只需追加扩展目录，不破坏 spec 协议。
 */

import type { DataCatalogEntry, ToolCatalogEntry } from "./types";

/* ------------------------------------------------------------------ */
/*  通用基础数据目录（跨场景共用）                                       */
/* ------------------------------------------------------------------ */

const BASE_DATA_CATALOG: DataCatalogEntry[] = [
  // 通用状态字段
  { path: "strings.statusMessage", type: "string", writable: true, usage: "当前状态说明" },
  { path: "strings.errorMessage", type: "string", writable: true, usage: "可恢复错误" },
  { path: "strings.title", type: "string", writable: true, usage: "通用标题" },
  { path: "strings.subtitle", type: "string", writable: true, usage: "通用副标题" },
  { path: "numbers.progress", type: "number", writable: true, usage: "0 到 100 的进度" },
];

/* ------------------------------------------------------------------ */
/*  旅行场景数据目录（扩展）                                            */
/* ------------------------------------------------------------------ */

const TRAVEL_DATA_CATALOG: DataCatalogEntry[] = [
  { path: "strings.destination", type: "string", writable: true, usage: "目的地" },
  { path: "strings.origin", type: "string", writable: true, usage: "出发地" },
  { path: "strings.travelDates", type: "string", writable: true, usage: "出行日期" },
  { path: "strings.tripDuration", type: "string", writable: true, usage: "行程天数" },
  { path: "strings.travelParty", type: "string", writable: true, usage: "出行人" },
  { path: "strings.budget", type: "string", writable: true, usage: "预算档位" },
  { path: "strings.transportMode", type: "string", writable: true, usage: "交通方式" },
  { path: "strings.accommodation", type: "string", writable: true, usage: "住宿偏好" },
  { path: "strings.highlight", type: "string", writable: true, usage: "亮点摘要" },
  { path: "stringLists.itinerary", type: "string[]", writable: true, usage: "行程安排列表" },
  { path: "stringLists.tips", type: "string[]", writable: true, usage: "出行提示列表" },
  { path: "stringLists.restaurants", type: "string[]", writable: true, usage: "餐厅推荐列表" },
  { path: "stringLists.checklist", type: "string[]", writable: true, usage: "行前清单列表" },
  { path: "numbers.totalBudget", type: "number", writable: true, usage: "总预算金额" },
  { path: "numbers.days", type: "number", writable: true, usage: "行程天数" },
];

/* ------------------------------------------------------------------ */
/*  合并的数据目录（用于校验 binding path 是否合法）                    */
/* ------------------------------------------------------------------ */

export const DATA_CATALOG: DataCatalogEntry[] = [
  ...BASE_DATA_CATALOG,
  ...TRAVEL_DATA_CATALOG,
];

/** 检查 path 是否在数据目录中 */
export function isKnownDataPath(path: string): boolean {
  if (!path) return false;
  return DATA_CATALOG.some((e) => e.path === path);
}

/** 取目录条目 */
export function getDataEntry(path: string): DataCatalogEntry | undefined {
  return DATA_CATALOG.find((e) => e.path === path);
}

/* ------------------------------------------------------------------ */
/*  工具能力目录（spec §9 + 通用扩展）                                   */
/* ------------------------------------------------------------------ */

const BASE_TOOL_CATALOG: ToolCatalogEntry[] = [
  // 通用导航工具（纯跳转，用于多卡流程的"下一步"）
  {
    adapterId: "local.navigate",
    operation: "go",
    inputs: [],
    outputs: ["strings.statusMessage"],
    outcomes: ["success"],
  },
  // 通用分享工具
  {
    adapterId: "local.share",
    operation: "share",
    inputs: ["strings.title", "strings.subtitle"],
    outputs: ["strings.statusMessage"],
    outcomes: ["success", "cancelled"],
  },
  // —— spec §9 文件/文档/剪贴板工具（PDF MVP 原生）——
  {
    adapterId: "system.file.pick",
    operation: "document",
    inputs: [],
    outputs: ["strings.selectedFileName", "strings.statusMessage"],
    outcomes: ["success", "cancelled", "error"],
  },
  {
    adapterId: "document.text.extract",
    operation: "extract",
    inputs: ["strings.selectedFileUri", "strings.outputFormat"],
    outputs: ["strings.previewText", "numbers.progress", "numbers.totalPages"],
    outcomes: ["success", "needsConfirmation", "error"],
  },
  {
    adapterId: "vision.ocr",
    operation: "recognize",
    inputs: ["strings.selectedFileUri"],
    outputs: ["strings.previewText"],
    outcomes: ["success", "error"],
  },
  {
    adapterId: "system.file.save",
    operation: "save",
    inputs: ["strings.outputFileName", "strings.outputFormat"],
    outputs: ["strings.outputFileUri", "strings.statusMessage"],
    outcomes: ["success", "cancelled", "error"],
  },
  {
    adapterId: "system.clipboard.write",
    operation: "write",
    inputs: ["strings.previewText"],
    outputs: ["strings.statusMessage"],
    outcomes: ["success", "error"],
  },
  // LLM 调用（卡片内 AI 分析/建议）
  {
    adapterId: "ai.llm",
    operation: "chat",
    inputs: ["strings.title", "strings.statusMessage"],
    outputs: ["strings.aiResponse", "strings.statusMessage"],
    outcomes: ["success", "error"],
  },
];

const TRAVEL_TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    adapterId: "travel.book",
    operation: "book",
    inputs: ["strings.destination", "strings.travelDates"],
    outputs: ["strings.statusMessage"],
    outcomes: ["success", "cancelled", "error"],
  },
  {
    adapterId: "travel.navigate",
    operation: "route",
    inputs: ["strings.destination"],
    outputs: ["strings.statusMessage"],
    outcomes: ["success", "error"],
  },
];

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  ...BASE_TOOL_CATALOG,
  ...TRAVEL_TOOL_CATALOG,
];

/** 按 adapterId + operation 查工具 */
export function findTool(
  adapterId: string,
  operation: string,
): ToolCatalogEntry | undefined {
  return TOOL_CATALOG.find(
    (t) => t.adapterId === adapterId && t.operation === operation,
  );
}

/** 把数据目录格式化为给 GLM 的提示文本 */
export function dataCatalogForPrompt(): string {
  return DATA_CATALOG.map(
    (e) => `- ${e.path} (${e.type}${e.writable ? ", 可写" : ", 只读"}): ${e.usage}`,
  ).join("\n");
}

/** 把工具目录格式化为给 GLM 的提示文本 */
export function toolCatalogForPrompt(): string {
  return TOOL_CATALOG.map(
    (t) =>
      `- ${t.adapterId} / ${t.operation}: outcomes=[${t.outcomes.join(", ")}]`,
  ).join("\n");
}
