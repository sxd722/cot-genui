import type { EffectiveAdaptiveContext, QueryClassification } from "./types";
import { isQueryClassification } from "./classification";

const FORBIDDEN = /忽略\s*system|ignore\s+previous|改变\s*schema|修改\s*json\s*格式|新增字段|删除字段|跳过步骤|直接输出|不要输出\s*json|调用工具|web_search|Query\s*\(|Mutation\s*\(|更换模型|reasoning_effort/i;
const ENTITY_LEAK = /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{10,}\b|(?:sk|key|token|secret|nvapi)[-_][a-z0-9_-]{12,}/i;

function sanitize(input: unknown, maxCodePoints: number): string {
  if (typeof input !== "string") return "";
  const normalized = input.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || FORBIDDEN.test(normalized) || ENTITY_LEAK.test(normalized)) return "";
  return [...normalized].slice(0, maxCodePoints).join("");
}

export function sanitizeSteeringHint(input: unknown): string {
  return sanitize(input, 180);
}

export function sanitizeProfileOverlay(input: unknown): string {
  return sanitize(input, 240);
}

export function sanitizeAdaptiveContext(value: unknown, fallback: QueryClassification): EffectiveAdaptiveContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<EffectiveAdaptiveContext>;
  return {
    classification: isQueryClassification(item.classification) ? item.classification : fallback,
    policyId: typeof item.policyId === "string" ? item.policyId.slice(0, 120) : "default-global",
    policyVersion: Number.isInteger(item.policyVersion) && Number(item.policyVersion) >= 0 ? Number(item.policyVersion) : 1,
    profileOverlay: sanitizeProfileOverlay(item.profileOverlay),
    stepHint: sanitizeSteeringHint(item.stepHint),
  };
}
