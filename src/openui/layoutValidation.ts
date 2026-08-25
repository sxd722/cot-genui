import type { ElementNode } from "@openuidev/lang-core";
import type { CardPlan } from "../dsl/modules";
import { cardPlanLayoutMode, FIXED_CARD_CONTENT_HEIGHT } from "./layoutPolicy";

const MAX_OPENUI_ELEMENTS = 14;
const FIXED_COMPONENTS = new Set(["FixedCardContent", "FixedFacts", "FixedList", "FixedMetrics", "FixedTimeline", "FixedComparison", "FixedMedia", "FixedGallery", "FixedActions", "HostActionChip", "HostActionItem"]);

export interface OpenUILayoutViolation {
  cardId: string;
  units: number;
  maxUnits: number;
  elements: number;
  reasons: string[];
}

export interface OpenUILayoutCoverage {
  mode: "fixed-600x300" | "free";
  valid: boolean;
  checkedCards: number;
  withinBudget: number;
  violations: OpenUILayoutViolation[];
}

function isElementNode(value: unknown): value is ElementNode {
  return !!value && typeof value === "object" && (value as Partial<ElementNode>).type === "element";
}

function stringWidth(value: string): number {
  let width = 0;
  for (const char of value) width += /[\u2e80-\u9fff\uf900-\ufaff]/.test(char) ? 1 : /\s/.test(char) ? 0.25 : 0.55;
  return width;
}

function lines(value: unknown, width = 44): number {
  return typeof value === "string" && value.trim() ? Math.max(1, Math.ceil(stringWidth(value) / width)) : 0;
}

function childElements(value: unknown): ElementNode[] {
  if (isElementNode(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(childElements);
  return [];
}

function fixedNodeHeight(node: ElementNode): number {
  if (node.typeName === "FixedFacts") {
    const items = Array.isArray(node.props.items) ? node.props.items : [];
    return items.reduce((sum, item) => sum + lines(item) * 15, 0) + Math.max(0, items.length - 1) * 6;
  }
  if (node.typeName === "FixedList") {
    const items = Array.isArray(node.props.items) ? node.props.items as Array<Record<string, unknown>> : [];
    const rows = Array.from({ length: Math.ceil(items.length / 2) }, (_, index) => items.slice(index * 2, index * 2 + 2));
    return rows.reduce((sum, row) => sum + Math.max(...row.map((item) => 28 + Math.max(0, lines(item.detail, 34) - 1) * 12), 28), 0) + Math.max(0, rows.length - 1) * 7;
  }
  if (node.typeName === "FixedMetrics") return 60;
  if (node.typeName === "FixedTimeline") {
    const count = Array.isArray(node.props.items) ? node.props.items.length : 0;
    return Math.ceil(count / 2) * 58 + Math.max(0, Math.ceil(count / 2) - 1) * 7;
  }
  if (node.typeName === "FixedComparison") {
    const columns = Array.isArray(node.props.columns) ? node.props.columns as Array<Record<string, unknown>> : [];
    const rows = Math.max(0, ...columns.map((column) => Array.isArray(column.rows) ? column.rows.length : 0));
    return 40 + rows * 26;
  }
  if (node.typeName === "FixedMedia" || node.typeName === "FixedGallery") return 118;
  if (node.typeName === "FixedActions") return 34;
  if (node.typeName === "FixedCardContent") {
    const content = childElements(node.props.content);
    const actions = childElements(node.props.actions);
    return content.reduce((sum, child) => sum + fixedNodeHeight(child), 0)
      + Math.max(0, content.length - 1) * 7
      + (actions.length ? 7 + fixedNodeHeight(actions[0]) : 0);
  }
  return 0;
}

function inspectValue(value: unknown, accumulator: { textWidth: number; elements: number; componentUnits: number; types: string[] }, key?: string) {
  if (typeof value === "string") {
    if (key === "cardId" || key === "assetRef" || key === "actionRef" || value.startsWith("plan:")) return;
    accumulator.textWidth += stringWidth(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => inspectValue(item, accumulator, key));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (isElementNode(value)) {
    accumulator.elements += 1;
    accumulator.types.push(value.typeName);
    accumulator.componentUnits += fixedNodeHeight(value);
    Object.entries(value.props).forEach(([propKey, propValue]) => inspectValue(propValue, accumulator, propKey));
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([propKey, propValue]) => inspectValue(propValue, accumulator, propKey));
}

export function validateOpenUILayout(generatedCards: ElementNode[], cardPlan: CardPlan): OpenUILayoutCoverage {
  const mode = cardPlanLayoutMode(cardPlan);
  if (mode === "free") return { mode, valid: true, checkedCards: 0, withinBudget: 0, violations: [] };

  const violations: OpenUILayoutViolation[] = [];
  generatedCards.forEach((card, index) => {
    const cardId = String(card.props.cardId ?? cardPlan.cards[index]?.id ?? `card_${index + 1}`);
    const accumulator = { textWidth: 0, elements: 0, componentUnits: 0, types: [] as string[] };
    inspectValue(card.props.children, accumulator, "children");
    const bodyChildren = childElements(card.props.children);
    const body = bodyChildren.length === 1 ? bodyChildren[0] : undefined;
    const units = body?.typeName === "FixedCardContent" ? fixedNodeHeight(body) : FIXED_CARD_CONTENT_HEIGHT + 1;
    const forbidden = [...new Set(accumulator.types.filter((type) => !FIXED_COMPONENTS.has(type)))];
    const reasons: string[] = [];
    if (!body || body.typeName !== "FixedCardContent") reasons.push("固定卡片 body 必须且只能包含一个 FixedCardContent");
    if (units > FIXED_CARD_CONTENT_HEIGHT) reasons.push(`静态预计高度 ${units}/${FIXED_CARD_CONTENT_HEIGHT}px`);
    if (accumulator.elements > MAX_OPENUI_ELEMENTS) reasons.push(`组件节点 ${accumulator.elements}/${MAX_OPENUI_ELEMENTS}`);
    if (forbidden.length) reasons.push(`固定画布只能使用有界组件：${forbidden.join(", ")}`);
    if (reasons.length) violations.push({ cardId, units, maxUnits: FIXED_CARD_CONTENT_HEIGHT, elements: accumulator.elements, reasons });
  });

  return {
    mode,
    valid: violations.length === 0 && generatedCards.length === cardPlan.cards.length,
    checkedCards: generatedCards.length,
    withinBudget: Math.max(0, generatedCards.length - violations.length),
    violations,
  };
}
