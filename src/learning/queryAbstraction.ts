import { z } from "zod";
import type { QueryAbstractionV1, SkillParameterValueKind } from "./workflowTypes";

const UNSAFE_TEXT = /(?:https?:\/\/|data:|javascript:|file:\/\/|[\u0000-\u0008\u000B\u000C\u000E-\u001F])/i;
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !UNSAFE_TEXT.test(value), "任务抽象不得包含 URL 或控制字符");

export const skillParameterValueKinds = ["location", "date", "number", "enum", "entity", "text"] as const;

export const queryAbstractionSchema = z.object({
  formatVersion: z.literal("genui-query-abstraction/1"),
  intentKey: z.string().trim().regex(/^[a-z][a-z0-9_]{2,63}$/),
  displayName: safeText(80),
  invariantSummary: safeText(300),
  invariantTerms: z.array(safeText(80)).min(1).max(20),
  parameters: z.array(z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
    label: safeText(80).optional(),
    valueKind: z.enum(skillParameterValueKinds),
    value: safeText(300).optional(),
    source: z.literal("query"),
    confidence: z.number().min(0).max(1),
  }).strict()).max(30),
  constraints: z.array(safeText(240)).max(20),
  confidence: z.number().min(0).max(1),
}).strict();

export function validateQueryAbstraction(value: unknown): QueryAbstractionV1 {
  const parsed = queryAbstractionSchema.parse(value);
  const parameters = new Map<string, (typeof parsed.parameters)[number]>();
  for (const parameter of parsed.parameters) {
    const existing = parameters.get(parameter.key);
    if (!existing || parameter.confidence > existing.confidence) parameters.set(parameter.key, parameter);
  }
  return {
    ...parsed,
    invariantTerms: [...new Set(parsed.invariantTerms)].slice(0, 20),
    parameters: [...parameters.values()].slice(0, 30),
    constraints: [...new Set(parsed.constraints)].slice(0, 20),
  } as QueryAbstractionV1;
}

export function displayQueryAbstraction(abstraction: QueryAbstractionV1): string {
  const parameters = abstraction.parameters.map((parameter) => (
    `${parameter.key}=${parameter.value || "?"}`
  ));
  return `${abstraction.displayName}${parameters.length ? `(${parameters.join(", ")})` : ""}`;
}

export function toGenericQueryAbstraction(abstraction: QueryAbstractionV1) {
  return {
    ...abstraction,
    parameters: abstraction.parameters.map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      valueKind: parameter.valueKind,
      source: parameter.source,
      confidence: parameter.confidence,
    })),
  };
}

export function parameterKindForKey(key: string): SkillParameterValueKind {
  const normalized = key.toLocaleLowerCase();
  if (/(destination|origin|location|city|country|address|place|地点|目的地)/i.test(normalized)) return "location";
  if (/(date|time|duration|deadline|day|日期|时间|天数)/i.test(normalized)) return "date";
  if (/(budget|price|amount|count|number|age|people|预算|价格|数量|人数|年龄)/i.test(normalized)) return "number";
  if (/(type|mode|level|category|style|类型|方式|等级|风格)/i.test(normalized)) return "enum";
  if (/(hotel|product|person|company|restaurant|entity|酒店|商品|人物|公司|餐厅)/i.test(normalized)) return "entity";
  return "text";
}
