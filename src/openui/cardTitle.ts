const MAX_CARD_TITLE_LENGTH = 10;

const PURPOSE_PREFIXES = [
  "用于帮助用户",
  "帮助用户",
  "支持用户",
  "便于用户",
  "让用户",
  "聚焦于",
  "围绕",
  "用于",
  "用来",
  "通过",
  "展示",
  "呈现",
  "说明",
  "介绍",
  "概括",
  "总结",
  "提供",
  "聚焦",
];

function stripPurposePrefix(value: string): string {
  let result = value;
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of PURPOSE_PREFIXES) {
      if (result.startsWith(prefix) && result.length > prefix.length) {
        result = result.slice(prefix.length);
        changed = true;
        break;
      }
    }
  }
  return result.replace(/^(?:整体|全局|完整)/, "");
}

/**
 * Derive a stable display title from the descriptive CardPlan purpose.
 * This is intentionally deterministic: it adds no model call and leaves the
 * complete purpose untouched for design/debug context.
 */
export function conciseCardTitle(purpose: unknown, fallback = "未命名卡片"): string {
  const normalized = String(purpose ?? "")
    .replace(/https?:\/\/[^\s<>()\]]+/gi, "")
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  const firstClause = normalized.split(/[、，,。；;！？!?：:]/).find((part) => part.trim())?.trim() ?? "";
  const candidate = stripPurposePrefix(firstClause)
    .replace(/^[\s·—–-]+|[\s·—–-]+$/g, "")
    .replace(/\s+/g, "");
  const safeValue = candidate || String(fallback || "未命名卡片").trim() || "未命名卡片";
  return [...safeValue].slice(0, MAX_CARD_TITLE_LENGTH).join("");
}
