import "server-only";

import { createLibrary, createParser, defineComponent } from "@openuidev/lang-core";
import { z } from "zod/v4";
import type { CardPlan, IRAction } from "@/dsl/modules";

const flexProps = {
  direction: z.enum(["row", "column"]).optional(),
  gap: z.enum(["none", "xs", "s", "m", "l", "xl", "2xl"]).optional(),
  align: z.enum(["start", "center", "end", "stretch", "baseline"]).optional(),
  justify: z.enum(["start", "center", "end", "between", "around", "evenly"]).optional(),
  wrap: z.boolean().optional(),
};

const component = <T extends z.ZodRawShape>(name: string, description: string, shape: T) =>
  defineComponent({ name, description, props: z.object(shape), component: null });

// Server-safe subset of the official React UI component signatures. The browser
// renders the same names with the full official @openuidev/react-ui library.
const Stack = component("Stack", "Flexible row or column layout", { children: z.array(z.any()), ...flexProps });
const Card = component("Card", "Visual group for related content", {
  children: z.array(z.any()),
  variant: z.enum(["card", "sunk", "clear"]).optional(),
  ...flexProps,
});
const CardHeader = component("CardHeader", "Card title and subtitle", { title: z.string().optional(), subtitle: z.string().optional() });
const TextContent = component("TextContent", "Text with optional hierarchy", {
  text: z.string(),
  size: z.enum(["small", "default", "large", "small-heavy", "large-heavy"]).optional(),
});
const Callout = component("Callout", "Highlighted status or advice", {
  variant: z.enum(["info", "warning", "error", "success", "neutral"]),
  title: z.string(),
  description: z.string(),
  visible: z.boolean().optional(),
});
const TextCallout = component("TextCallout", "Compact highlighted text", {
  variant: z.enum(["neutral", "info", "warning", "success", "danger"]).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});
const TagBlock = component("TagBlock", "Group of compact text tags", { tags: z.array(z.string()) });
const Tag = component("Tag", "Single status tag", {
  text: z.string(),
  icon: z.string().optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
  variant: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
});
const StepsItem = component("StepsItem", "One step with title and details", { title: z.string(), details: z.string() });
const Steps = component("Steps", "Step-by-step guide", { items: z.array(StepsItem.ref) });
const Separator = component("Separator", "Visual separator", {
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  decorative: z.boolean().optional(),
});
const Button = component("Button", "Clickable host-bound action", {
  label: z.string(),
  action: z.any().optional(),
  variant: z.enum(["primary", "secondary", "tertiary"]).optional(),
  type: z.enum(["normal", "destructive"]).optional(),
  size: z.enum(["extra-small", "small", "medium", "large"]).optional(),
});
const Buttons = component("Buttons", "Row or column of buttons", {
  buttons: z.array(Button.ref),
  direction: z.enum(["row", "column"]).optional(),
});
const Col = component("Col", "Column label and data array", {
  label: z.string(),
  data: z.any(),
  type: z.enum(["string", "number", "action"]).optional(),
});
const Table = component("Table", "Column-oriented table", { columns: z.array(Col.ref) });
const Series = component("Series", "One chart data series", { category: z.string(), values: z.array(z.number()) });
const BarChart = component("BarChart", "Vertical comparison chart", {
  labels: z.array(z.string()),
  series: z.array(Series.ref),
  variant: z.enum(["grouped", "stacked"]).optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
});
const LineChart = component("LineChart", "Trend chart", {
  labels: z.array(z.string()),
  series: z.array(Series.ref),
  variant: z.enum(["linear", "natural", "step"]).optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
});
const ImageBlock = component("ImageBlock", "Image with accessible alt text", { src: z.string(), alt: z.string().optional() });

const openuiLibrary = createLibrary({
  id: "cot-genui-openui-v1",
  root: "Stack",
  components: [Stack, Card, CardHeader, TextContent, Callout, TextCallout, TagBlock, Tag, StepsItem, Steps, Separator, Button, Buttons, Col, Table, Series, BarChart, LineChart, ImageBlock],
  componentGroups: [
    { name: "Layout", components: ["Stack", "Card", "CardHeader", "Separator"] },
    { name: "Content", components: ["TextContent", "Callout", "TextCallout", "TagBlock", "Tag", "Steps", "StepsItem", "ImageBlock"] },
    { name: "Data", components: ["Table", "Col", "BarChart", "LineChart", "Series"] },
    { name: "Actions", components: ["Buttons", "Button"] },
  ],
});

export interface OpenUIActionBinding {
  ref: string;
  cardId: string;
  actionId: string;
  label: string;
  type: IRAction["type"];
  role: IRAction["role"];
}

export interface OpenUIValidationResult {
  valid: boolean;
  errors: string[];
  coverage: {
    required: number;
    matched: number;
    missing: string[];
  };
  parser: {
    statements: number;
    unresolved: string[];
    orphaned: string[];
    incomplete: boolean;
  };
}

const OPENUI_RULES = [
  "The user payload contains a CardPlan with N cards. Create exactly N distinct Card(...) components: one visual card for each CardPlan card, in the same order.",
  "The root must be a Stack that exposes all N card references directly or through layout-only Stack components. The cards must be visual peers; never merge multiple CardPlan cards into one Card and never nest one Card inside another Card.",
  "Every generated Card must start with a CardHeader. Use that CardPlan card's purpose as its title so the card boundary and mapping remain obvious.",
  "Render every card, block, list item, metric, option, and action; do not summarize away content or move content into a different card.",
  "Prefer a polished dashboard-like composition with clear hierarchy, compact spacing, varied content components, and responsive wrapped rows.",
  "Do not use Query, Mutation, @Run, @OpenUrl, forms, or invented URLs. The host application owns all side effects.",
  "For every CardPlan action, create exactly one Button whose action is Action([@ToAssistant(action ref)]). Copy the supplied action ref exactly; never expose it as visible text.",
  "Keep all user-visible CardPlan text exact enough for deterministic coverage checks. Escape strings using valid OpenUI Lang syntax.",
  "Only use image URLs already present in CardPlan. Do not invent image URLs.",
  "Return only OpenUI Lang. Do not use Markdown fences, JSON, XML, JSX, HTML, comments, or explanatory prose.",
];

export const OPENUI_SYSTEM_PROMPT = openuiLibrary.prompt({
  preamble: "You are a CardPlan-driven multi-card visual UI compiler. Produce a complete, compilable OpenUI Lang program whose visible card count exactly matches the input CardPlan.",
  additionalRules: OPENUI_RULES,
  toolCalls: false,
  bindings: false,
  examples: [
    `root = Stack([overview, schedule, tips], "column", "m", "stretch", "start", true)
overview = Card([overviewHeader, overviewText, overviewTags])
overviewHeader = CardHeader("Overview", "A relaxed two-day plan")
overviewText = TextContent("Start with the most important recommendation.")
overviewTags = TagBlock(["Low walking", "Family friendly"])
schedule = Card([scheduleHeader, scheduleSteps])
scheduleHeader = CardHeader("Schedule", "Two days at a glance")
scheduleSteps = Steps([dayOne, dayTwo])
dayOne = StepsItem("Day one", "Arrive, check in, and explore nearby.")
dayTwo = StepsItem("Day two", "Visit the main destination and return.")
tips = Card([tipsHeader, tipCallout])
tipsHeader = CardHeader("Before you go")
tipCallout = Callout("info", "Reservation", "Book the official entry in advance.")`,
    `root = Stack([summaryCard, comparisonCard, actionCard], "column", "m", "stretch", "start", true)
summaryCard = Card([summaryHeader, summaryText])
summaryHeader = CardHeader("Summary", "Recommended direction")
summaryText = TextContent("Option A is the best overall fit.")
comparisonCard = Card([comparisonHeader, table])
comparisonHeader = CardHeader("Comparison", "Key differences")
table = Table([nameCol, reasonCol])
nameCol = Col("Option", ["A", "B"])
reasonCol = Col("Why", ["Best value", "Most convenient"])
actionCard = Card([actionHeader, actions])
actionHeader = CardHeader("Next step", "Continue with the selected option")
actions = Buttons([details])
details = Button("View details", Action([@ToAssistant("plan:results:view")]), "primary")`,
  ],
});

export function openUIActionRef(cardId: string, actionId: string): string {
  return `plan:${encodeURIComponent(cardId)}:${encodeURIComponent(actionId)}`;
}

export function buildOpenUIActionBindings(cardPlan: CardPlan): OpenUIActionBinding[] {
  return cardPlan.cards.flatMap((card) => (card.actions ?? []).map((action) => ({
    ref: openUIActionRef(card.id, action.id),
    cardId: card.id,
    actionId: action.id,
    label: action.label,
    type: action.type,
    role: action.role,
  })));
}

/** Remove common chat wrappers without attempting to rewrite OpenUI syntax. */
export function normalizeOpenUIOutput(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:openui(?:-lang)?|text)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function normalizedVisibleText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function collectRequiredText(cardPlan: CardPlan): string[] {
  // skillName/purpose are planning metadata and may be rewritten into a more
  // natural visual heading. Enforce the business-bearing block/action content.
  const values: string[] = [];
  for (const card of cardPlan.cards) {
    for (const block of card.blocks) {
      values.push(block.title ?? "", block.text ?? "", block.detail ?? "", block.value ?? "");
      for (const item of block.items ?? []) values.push(item.label, item.detail ?? "");
      for (const option of block.options ?? []) values.push(option);
      for (const metric of block.metrics ?? []) values.push(metric.label, `${metric.value}${metric.unit ?? ""}`);
    }
    for (const action of card.actions ?? []) values.push(action.label);
  }
  return [...new Set(values.map((value) => value.trim()).filter((value) => normalizedVisibleText(value).length >= 2))];
}

export function validateOpenUIArtifact(code: string, cardPlan: CardPlan): OpenUIValidationResult {
  const errors: string[] = [];
  const parser = createParser(openuiLibrary.toJSONSchema());
  const parsed = parser.parse(code);
  if (!parsed.root) errors.push("未生成可渲染的 root 组件");
  if (parsed.meta.incomplete) errors.push("OpenUI 程序不完整或被截断");
  if (parsed.meta.unresolved.length) errors.push(`存在未解析引用: ${parsed.meta.unresolved.join(", ")}`);
  for (const item of parsed.meta.errors) {
    errors.push(`${item.statementId ? `${item.statementId}: ` : ""}${item.code} ${item.message}`);
  }
  if (parsed.queryStatements.length || parsed.mutationStatements.length) {
    errors.push("禁止在第⑥步产物中使用 Query/Mutation 工具调用");
  }
  if (/@(?:OpenUrl|Run)\s*\(/.test(code)) errors.push("禁止使用 @OpenUrl/@Run；动作必须引用 CardPlan action");

  const expectedCardCount = cardPlan.cards.length;
  const renderedCardCount = code.match(/\bCard\s*\(/g)?.length ?? 0;
  if (renderedCardCount !== expectedCardCount) {
    errors.push(`OpenUI 独立卡片数量不匹配：CardPlan 要求 ${expectedCardCount} 张，实际生成 ${renderedCardCount} 张`);
  }

  const normalizedCode = normalizedVisibleText(code);
  const requiredText = collectRequiredText(cardPlan);
  const missingText = requiredText.filter((value) => !normalizedCode.includes(normalizedVisibleText(value)));
  const actionRefs = buildOpenUIActionBindings(cardPlan).map((binding) => binding.ref);
  const missingActions = actionRefs.filter((ref) => !code.includes(ref));
  if (missingText.length) errors.push(`缺少 CardPlan 可见内容: ${missingText.join(" | ")}`);
  if (missingActions.length) errors.push(`缺少 CardPlan action 引用: ${missingActions.join(", ")}`);

  const missing = [...missingText, ...missingActions];
  return {
    valid: errors.length === 0,
    errors,
    coverage: {
      required: requiredText.length + actionRefs.length,
      matched: requiredText.length + actionRefs.length - missing.length,
      missing,
    },
    parser: {
      statements: parsed.meta.statementCount,
      unresolved: parsed.meta.unresolved,
      orphaned: parsed.meta.orphaned,
      incomplete: parsed.meta.incomplete,
    },
  };
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/** Minimal deterministic artifact used only when no LLM key is configured. */
export function mockOpenUIFromCardPlan(cardPlan: CardPlan): string {
  const lines = ["root = Stack([pageTitle], \"column\", \"m\", \"stretch\", \"start\", true)"];
  lines.push(`pageTitle = TextContent(${quote(cardPlan.skillName)}, "large-heavy")`);
  const cardRefs: string[] = [];
  cardPlan.cards.forEach((card, cardIndex) => {
    const cardRef = `card${cardIndex + 1}`;
    const titleRef = `${cardRef}Title`;
    const bodyRef = `${cardRef}Body`;
    cardRefs.push(cardRef);
    lines.push(`${cardRef} = Card([${titleRef}, ${bodyRef}])`);
    lines.push(`${titleRef} = CardHeader(${quote(card.purpose)})`);
    const text = card.blocks.flatMap((block) => [block.title, block.text, block.value, ...(block.items ?? []).map((item) => item.label)]).filter(Boolean).join(" · ");
    lines.push(`${bodyRef} = TextContent(${quote(text || card.purpose)})`);
  });
  lines[0] = `root = Stack([pageTitle, ${cardRefs.join(", ")}], "column", "m", "stretch", "start", true)`;
  return lines.join("\n");
}
