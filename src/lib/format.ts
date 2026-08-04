/**
 * LLM 返回值的安全格式化工具
 *
 * 背景：分步推理用宽松 schema，模型返回的字段不保证是字符串——
 * 可能是对象（如 {source_record, inferred_value, reasoning}）、数组、数字、null。
 * 直接把这些值作为 React 子节点会抛
 * "Objects are not valid as a React child"。
 *
 * 这里统一把任意值转成可安全渲染的字符串。
 */

/**
 * 把任意 LLM 返回值转成可渲染的字符串。
 * - string → 原样
 * - number / boolean → String()
 * - null / undefined → fallback（默认空串）
 * - 对象/数组 → JSON 美化（紧凑情况下直接 JSON.stringify）
 */
export function toText(
  v: unknown,
  fallback = "",
): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // 对象 / 数组
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** 单行版本（对象/数组不换行），用于表格单元格等紧凑场景 */
export function toTextInline(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
