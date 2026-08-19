import "server-only";

import {
  createParser,
  generateSystemPrompt,
  type ElementNode,
  type LibraryJSONSchema,
  type LibrarySpec,
} from "@openuidev/lang-core";
import type { CardPlan, IRAction } from "@/dsl/modules";
import { buildOpenUIBootstrap } from "@/openui/bootstrap";
import librarySpecJson from "@/openui/generated/system-prompt.spec.json";
import compactGeneralSpecJson from "@/openui/generated/compact-general.spec.json";
import compactPlanningSpecJson from "@/openui/generated/compact-planning.spec.json";
import compactRecommendationSpecJson from "@/openui/generated/compact-recommendation.spec.json";
import compactAnalysisSpecJson from "@/openui/generated/compact-analysis.spec.json";
import expandedSpecJson from "@/openui/generated/expanded.spec.json";
import { cotGenUIPromptOptions, createCotGenUIPromptOptions, examplesForTaskFamily } from "@/openui/promptOptions";
import type { TaskFamily } from "@/lib/adaptive/types";
import type { ModelProfile } from "@/lib/pipelineTypes";
import { openUIPromptTierFor } from "@/openui/modelCapabilities";
import { paletteNameForTaskFamily } from "@/openui/palettes";
import { containsRawExternalUrl, forbiddenOpenUIActions } from "@/openui/localInteraction";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { invalidAssetRefsInTree, type AssetManifest } from "@/openui/assetTypes";

const librarySpec = librarySpecJson as LibrarySpec;

export const OPENUI_SYSTEM_PROMPT = generateSystemPrompt({
  library: librarySpec,
  promptOptions: cotGenUIPromptOptions,
});

const promptSpecs = {
  general: compactGeneralSpecJson as LibrarySpec,
  planning: compactPlanningSpecJson as LibrarySpec,
  recommendation: compactRecommendationSpecJson as LibrarySpec,
  analysis: compactAnalysisSpecJson as LibrarySpec,
  expanded: expandedSpecJson as LibrarySpec,
};

export function openUISystemPromptFor(args: { taskFamily: TaskFamily; modelProfile: ModelProfile }): { prompt: string; promptProfile: string } {
  const tier = openUIPromptTierFor(args.modelProfile);
  const familyPalette = paletteNameForTaskFamily(args.taskFamily);
  const palette = tier === "expanded" ? "expanded" : familyPalette;
  const familyExamples = examplesForTaskFamily(args.taskFamily);
  const examples = tier === "expanded" && familyPalette !== "general"
    ? [...familyExamples, examplesForTaskFamily("general")[0]]
    : familyExamples;
  const promptOptions = createCotGenUIPromptOptions({ localBindings: FEATURE_FLAGS.OPENUI_LOCAL_BINDINGS, examples });
  return {
    prompt: generateSystemPrompt({ library: promptSpecs[palette], promptOptions }),
    promptProfile: `${tier}:${tier === "expanded" ? "general" : palette}`,
  };
}

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

function isElementNode(value: unknown): value is ElementNode {
  return !!value && typeof value === "object" && (value as Partial<ElementNode>).type === "element";
}

function occurrences(source: string, value: string): number {
  if (!value) return 0;
  return source.split(value).length - 1;
}

export function validateOpenUIArtifact(code: string, cardPlan: CardPlan, assetManifest?: AssetManifest): OpenUIValidationResult {
  const errors: string[] = [];
  const parser = createParser(librarySpec.schema as LibraryJSONSchema);
  const parsed = parser.parse(code);
  if (!parsed.root) errors.push("未生成可渲染的 root 组件");
  if (parsed.root && parsed.root.typeName !== "CardDeck") errors.push(`root 必须是 CardDeck，实际为 ${parsed.root.typeName}`);
  if (parsed.meta.incomplete) errors.push("OpenUI 程序不完整或被截断");
  if (parsed.meta.unresolved.length) errors.push(`存在未解析引用: ${parsed.meta.unresolved.join(", ")}`);
  for (const item of parsed.meta.errors) {
    errors.push(`${item.statementId ? `${item.statementId}: ` : ""}${item.code} ${item.message}`);
  }
  if (parsed.queryStatements.length || parsed.mutationStatements.length) {
    errors.push("禁止在第⑥步产物中使用 Query/Mutation 工具调用");
  }
  const forbiddenActions = forbiddenOpenUIActions(code);
  if (forbiddenActions.length) errors.push(`禁止使用 ${forbiddenActions.map((name) => `@${name}`).join("/")}；动作必须引用 CardPlan action`);
  if (containsRawExternalUrl(code)) errors.push("OpenUI 源码不得包含外部 URL；外部能力必须通过 actionRef");
  if (assetManifest && parsed.root) {
    const invalidAssetRefs = invalidAssetRefsInTree(parsed.root, assetManifest);
    if (invalidAssetRefs.length) errors.push(`使用了宿主未提供的 assetRef: ${invalidAssetRefs.join(", ")}`);
  }

  const rootChildren = Array.isArray(parsed.root?.props.children) ? parsed.root.props.children : [];
  const renderedCards = rootChildren.filter(isElementNode);
  const nonCardChildren = renderedCards.filter((item) => item.typeName !== "GeneratedCard");
  if (nonCardChildren.length) errors.push("CardDeck 的直接子项只能是 GeneratedCard");

  const generatedCards = renderedCards.filter((item) => item.typeName === "GeneratedCard");
  if (generatedCards.length !== cardPlan.cards.length) {
    errors.push(`OpenUI 独立卡片数量不匹配：CardPlan 要求 ${cardPlan.cards.length} 张，实际生成 ${generatedCards.length} 张`);
  }
  const generatedIds = generatedCards.map((item) => String(item.props.cardId ?? ""));
  const expectedIds = cardPlan.cards.map((card) => card.id);
  if (generatedIds.join("\u0000") !== expectedIds.join("\u0000")) {
    errors.push(`GeneratedCard 顺序或 cardId 不匹配：期望 ${expectedIds.join(" → ")}，实际 ${generatedIds.join(" → ") || "无"}`);
  }

  const bindings = buildOpenUIActionBindings(cardPlan);
  const missingCards = expectedIds.filter((id) => !generatedIds.includes(id)).map((id) => `card:${id}`);
  const missingActions = bindings.filter((binding) => occurrences(code, binding.ref) === 0).map((binding) => binding.ref);
  const duplicateActions = bindings.filter((binding) => occurrences(code, binding.ref) > 1).map((binding) => binding.ref);
  if (missingActions.length) errors.push(`缺少 CardPlan action 引用: ${missingActions.join(", ")}`);
  if (duplicateActions.length) errors.push(`CardPlan action 引用重复: ${duplicateActions.join(", ")}`);

  const missing = [...missingCards, ...missingActions];
  const required = expectedIds.length + bindings.length;
  return {
    valid: errors.length === 0,
    errors,
    coverage: {
      required,
      matched: required - missing.length,
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

function cardBodyText(card: CardPlan["cards"][number]): string {
  const parts = card.blocks.flatMap((block) => [
    block.title,
    block.value,
    block.text,
    block.detail,
    ...(block.items ?? []).flatMap((item) => [item.label, item.detail]),
    ...(block.metrics ?? []).map((metric) => `${metric.label}：${metric.value}${metric.unit ?? ""}`),
  ]).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return parts.join(" · ") || card.purpose;
}

/** Minimal deterministic artifact used only when the selected model is unavailable. */
export function mockOpenUIFromCardPlan(cardPlan: CardPlan): string {
  const bootstrap = buildOpenUIBootstrap(cardPlan);
  const lines = [bootstrap.code];
  cardPlan.cards.forEach((card, index) => {
    const bodyRef = bootstrap.bodyRefs[index].bodyRef;
    const textRef = `${bodyRef}_text`;
    const actionRefs = (card.actions ?? []).map((_, actionIndex) => `${bodyRef}_action_${actionIndex}`);
    lines.push(`${bodyRef} = Stack([${[textRef, ...actionRefs].join(", ")}], "column", "m")`);
    lines.push(`${textRef} = TextContent(${JSON.stringify(cardBodyText(card))})`);
    (card.actions ?? []).forEach((action, actionIndex) => {
      lines.push(`${actionRefs[actionIndex]} = HostActionChip(${JSON.stringify(action.label)}, ${JSON.stringify(openUIActionRef(card.id, action.id))})`);
    });
  });
  return lines.join("\n");
}
