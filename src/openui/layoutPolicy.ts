import type { CardLayoutMode, CardLayoutPolicy, CardNode, CardPlan, IRBlock } from "../dsl/modules";
import { conciseCardTitle } from "./cardTitle";

export const DEFAULT_CARD_LAYOUT_MODE: CardLayoutMode = "fixed-600x300";
export const CARD_LAYOUT_STORAGE_KEY = "cot-genui.card-layout-mode";
export const FIXED_CARD_WIDTH = 600;
export const FIXED_CARD_HEIGHT = 300;
export const FIXED_CARD_HEADER_HEIGHT = 58;
export const FIXED_CARD_BODY_HEIGHT = 242;
export const FIXED_CARD_CONTENT_HEIGHT = 218;
/** Compatibility projection for older diagnostics and prompt payloads. */
export const FIXED_CARD_BUDGET_UNITS = FIXED_CARD_CONTENT_HEIGHT;

export interface CardLayoutBudgetItem {
  cardId: string;
  units: number;
  maxUnits: number;
  estimatedHeightPx: number;
  maxHeightPx: number;
  contentSlots: number;
  fits: boolean;
  reasons: string[];
}

export interface CardLayoutBudgetDiagnostics {
  mode: CardLayoutMode;
  originalCardCount: number;
  finalCardCount: number;
  splitCards: Array<{ sourceCardId: string; generatedCardIds: string[] }>;
  cards: CardLayoutBudgetItem[];
  valid: boolean;
}

export function isCardLayoutMode(value: unknown): value is CardLayoutMode {
  return value === "fixed-600x300" || value === "free";
}

export function normalizeCardLayoutMode(value: unknown, fallback: CardLayoutMode = DEFAULT_CARD_LAYOUT_MODE): CardLayoutMode {
  return isCardLayoutMode(value) ? value : fallback;
}

export function cardLayoutPolicy(mode: CardLayoutMode): CardLayoutPolicy {
  return mode === "fixed-600x300"
    ? { mode, cardWidth: FIXED_CARD_WIDTH, cardHeight: FIXED_CARD_HEIGHT, overflow: "forbid", innerScroll: false }
    : { mode };
}

export function cardPlanLayoutMode(plan: CardPlan): CardLayoutMode {
  return normalizeCardLayoutMode(plan.layoutPolicy?.mode, "free");
}

export function withCardLayoutPolicy(plan: CardPlan, mode: CardLayoutMode): CardPlan {
  return { ...plan, layoutPolicy: cardLayoutPolicy(mode) };
}

function textWidthUnits(value: unknown): number {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  let width = 0;
  for (const char of text) width += (/[⺀-鿿豈-﫿]/.test(char) ? 1 : /\s/.test(char) ? 0.25 : 0.55);
  return Math.max(1, Math.ceil(width / 44));
}

function textHeight(value: unknown, lineHeight = 17): number {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  return Math.max(lineHeight, textWidthUnits(text) * lineHeight);
}

function blockHeight(block: IRBlock): number {
  let height = block.title ? textHeight(block.title, 16) : 0;
  height += textHeight(block.text) + textHeight(block.detail, 15) + textHeight(block.value);
  if (block.items?.length) {
    const rows = Math.ceil(block.items.length / 2);
    const rowHeight = Math.max(...block.items.map((item) => 30 + Math.max(0, textWidthUnits(item.detail) - 1) * 12), 30);
    height += rows * rowHeight + Math.max(0, rows - 1) * 7;
  }
  if (block.metrics?.length) height += Math.ceil(block.metrics.length / 3) * 62;
  if (block.options?.length) height += Math.ceil(block.options.length / 2) * 34;
  if (block.assetRequest || block.kind === "image" || block.kind === "infographic") {
    height += 118;
  } else if (block.kind === "chart") {
    height += 168;
  } else if (block.kind === "progress" || block.kind === "toggle" || block.kind === "choice") {
    height += 38;
  }
  return Math.max(28, Math.ceil(height));
}

export function estimateCardLayout(card: CardNode): CardLayoutBudgetItem {
  const contentHeight = card.blocks.reduce((sum, block, index) => sum + blockHeight(block) + (index ? 7 : 0), 0);
  const actionHeight = card.actions?.length ? Math.ceil(card.actions.length / 2) * 34 + 7 : 0;
  const estimatedHeightPx = contentHeight + actionHeight;
  const units = estimatedHeightPx;
  const reasons: string[] = [];
  const listItems = card.blocks.reduce((sum, block) => sum + (block.items?.length ?? 0), 0);
  const metrics = card.blocks.reduce((sum, block) => sum + (block.metrics?.length ?? 0), 0);
  const options = card.blocks.reduce((sum, block) => sum + (block.options?.length ?? 0), 0);
  if (card.blocks.length > 2) reasons.push(`内容块 ${card.blocks.length}/2`);
  if (listItems > 4) reasons.push(`列表项 ${listItems}/4`);
  if (metrics > 3) reasons.push(`指标 ${metrics}/3`);
  if (options > 4) reasons.push(`选项 ${options}/4`);
  if ((card.actions?.length ?? 0) > 2) reasons.push(`动作 ${card.actions?.length ?? 0}/2`);
  if (estimatedHeightPx > FIXED_CARD_CONTENT_HEIGHT) reasons.push(`预计正文高度 ${estimatedHeightPx}/${FIXED_CARD_CONTENT_HEIGHT}px`);
  return {
    cardId: card.id, units, maxUnits: FIXED_CARD_CONTENT_HEIGHT,
    estimatedHeightPx, maxHeightPx: FIXED_CARD_CONTENT_HEIGHT,
    contentSlots: card.blocks.length + (card.actions?.length ? 1 : 0),
    fits: reasons.length === 0, reasons,
  };
}

function splitText(value: string, maxWidth = 88): string[] {
  const source = value.trim();
  if (!source || textWidthUnits(source) <= 2) return source ? [source] : [];
  const sentences = source.match(/[^。！？!?；;\n]+[。！？!?；;]?|[^\n]+/g)?.map((item) => item.trim()).filter(Boolean) ?? [source];
  const chunks: string[] = [];
  let current = "";
  const weightedWidth = (text: string) => [...text].reduce((sum, char) => sum + (/[⺀-鿿豈-﫿]/.test(char) ? 1 : /\s/.test(char) ? 0.25 : 0.55), 0);
  const pushHard = (text: string) => {
    let part = "";
    for (const char of text) {
      if (part && weightedWidth(part + char) > maxWidth) { chunks.push(part); part = ""; }
      part += char;
    }
    if (part) chunks.push(part);
  };
  for (const sentence of sentences) {
    if (weightedWidth(sentence) > maxWidth) {
      if (current) { chunks.push(current); current = ""; }
      pushHard(sentence);
    } else if (!current || weightedWidth(current + sentence) <= maxWidth) current += sentence;
    else { chunks.push(current); current = sentence; }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitCollectionBlock(block: IRBlock): IRBlock[] {
  if (block.items?.length) {
    const expandedItems = block.items.flatMap((item) => {
      const labelChunks = splitText(item.label, 38);
      const detailChunks = item.detail ? splitText(item.detail, 70) : [];
      const count = Math.max(1, labelChunks.length, detailChunks.length);
      if (count === 1) return [item];
      return Array.from({ length: count }, (_, index) => ({
        label: labelChunks[index] ?? "",
        ...(detailChunks[index] ? { detail: detailChunks[index] } : {}),
        ...(index === 0 && item.onSelect ? { onSelect: item.onSelect } : {}),
      }));
    });
    if (expandedItems.length > 2 || expandedItems.some((item, index) => item !== block.items?.[index])) {
      const chunks: IRBlock[] = [];
      for (let index = 0; index < expandedItems.length; index += 2) {
        chunks.push(index === 0
          ? { ...block, items: expandedItems.slice(index, index + 2) }
          : { kind: block.kind, tone: block.tone, sourceSlots: block.sourceSlots, items: expandedItems.slice(index, index + 2) });
      }
      return chunks;
    }
  }
  if ((block.items?.length ?? 0) > 2) {
    const chunks: IRBlock[] = [];
    for (let index = 0; index < (block.items?.length ?? 0); index += 2) chunks.push(index === 0
      ? { ...block, items: block.items?.slice(index, index + 2) }
      : { kind: block.kind, tone: block.tone, sourceSlots: block.sourceSlots, items: block.items?.slice(index, index + 2) });
    return chunks;
  }
  if ((block.metrics?.length ?? 0) > 3) {
    const chunks: IRBlock[] = [];
    for (let index = 0; index < (block.metrics?.length ?? 0); index += 3) {
      chunks.push(index === 0
        ? { ...block, metrics: block.metrics?.slice(index, index + 3) }
        : { kind: block.kind, tone: block.tone, sourceSlots: block.sourceSlots, metrics: block.metrics?.slice(index, index + 3) });
    }
    return chunks;
  }
  if ((block.options?.length ?? 0) > 4) {
    const chunks: IRBlock[] = [];
    for (let index = 0; index < (block.options?.length ?? 0); index += 4) {
      chunks.push(index === 0
        ? { ...block, options: block.options?.slice(index, index + 4) }
        : { kind: block.kind, tone: block.tone, sourceSlots: block.sourceSlots, options: block.options?.slice(index, index + 4) });
    }
    return chunks;
  }
  const textKeys = (["text", "detail", "value"] as const).filter((key) => typeof block[key] === "string" && !!block[key]?.trim());
  const hasMedia = !!block.assetRequest || block.kind === "image" || block.kind === "infographic";
  const textTooTall = blockHeight(block) > (hasMedia ? 176 : FIXED_CARD_CONTENT_HEIGHT);
  if (!textTooTall || !textKeys.length) return [block];
  const base: IRBlock = { ...block };
  textKeys.forEach((key) => { delete base[key]; });
  const fragments: IRBlock[] = [];
  textKeys.forEach((key) => splitText(String(block[key] ?? "")).forEach((value, index) => {
    const first = fragments.length === 0;
    fragments.push({
      ...(first ? base : { kind: key === "detail" ? "text" as const : block.kind, tone: block.tone, sourceSlots: block.sourceSlots }),
      ...(first ? {} : { title: undefined, assetRequest: undefined }),
      [key]: value,
      ...(index > 0 ? { title: undefined } : {}),
    });
  }));
  return fragments.length ? fragments : [block];
}

function partitionCard(card: CardNode): CardNode[] {
  const blocks = card.blocks.flatMap(splitCollectionBlock);
  const actions = card.actions ?? [];
  const contentBudget = FIXED_CARD_CONTENT_HEIGHT - (actions.length > 0 && actions.length <= 2 ? 41 : 0);
  const groups: IRBlock[][] = [];
  let current: IRBlock[] = [];
  let currentUnits = 0;
  let currentItems = 0;
  let currentMetrics = 0;
  let currentOptions = 0;
  for (const block of blocks) {
    const units = blockHeight(block);
    const items = block.items?.length ?? 0;
    const metrics = block.metrics?.length ?? 0;
    const options = block.options?.length ?? 0;
    const currentHasMedia = current.some((item) => !!item.assetRequest || item.kind === "image" || item.kind === "infographic");
    const blockHasMedia = !!block.assetRequest || block.kind === "image" || block.kind === "infographic";
    if (current.length && (current.length >= 2 || currentHasMedia || blockHasMedia || currentUnits + units + 7 > contentBudget || currentItems + items > 4 || currentMetrics + metrics > 3 || currentOptions + options > 4)) {
      groups.push(current);
      current = [];
      currentUnits = 0;
      currentItems = 0;
      currentMetrics = 0;
      currentOptions = 0;
    }
    current.push(block);
    currentUnits += units + (current.length > 1 ? 7 : 0);
    currentItems += items;
    currentMetrics += metrics;
    currentOptions += options;
  }
  if (current.length || !groups.length) groups.push(current);
  if (groups.length === 1 && actions.length <= 2 && estimateCardLayout(card).fits) return [card];

  const actionGroups: CardNode["actions"][] = [];
  if (actions.length > 2) for (let index = 0; index < actions.length; index += 2) actionGroups.push(actions.slice(index, index + 2));

  const baseTitle = conciseCardTitle(card.title ?? card.purpose, "卡片");
  const contentCards: CardNode[] = groups.map((group, index) => ({
    ...card,
    id: index === 0 ? card.id : `${card.id}__${index + 1}`,
    title: index === 0 ? baseTitle : conciseCardTitle(`${baseTitle}续${index + 1}`, `续${index + 1}`),
    purpose: index === 0 ? card.purpose : `${card.purpose}（续 ${index + 1}）`,
    blocks: group,
    presentation: { ...(card.presentation ?? { archetype: "standard" as const }), density: "compact" as const },
    actions: actions.length <= 2 && index === groups.length - 1 ? actions : undefined,
  }));
  const actionCards = actionGroups.map((group, index) => ({
    ...card,
    id: `${card.id}__actions_${index + 1}`,
    title: conciseCardTitle(`${baseTitle}操作${index + 1}`, `操作${index + 1}`),
    purpose: `${card.purpose}（操作 ${index + 1}）`,
    blocks: [{ kind: "summary" as const, text: "请选择下一步操作。" }],
    presentation: { archetype: "action" as const, density: "compact" as const, emphasis: "action" as const },
    actions: group,
  }));
  return [...contentCards, ...actionCards];
}

export function fitCardPlanToLayout(plan: CardPlan, mode: CardLayoutMode): { plan: CardPlan; diagnostics: CardLayoutBudgetDiagnostics } {
  const withPolicy = withCardLayoutPolicy(plan, mode);
  if (mode === "free") {
    return {
      plan: withPolicy,
      diagnostics: { mode, originalCardCount: plan.cards.length, finalCardCount: plan.cards.length, splitCards: [], cards: [], valid: true },
    };
  }

  const splitCards: CardLayoutBudgetDiagnostics["splitCards"] = [];
  const cards = withPolicy.cards.flatMap((card) => {
    const parts = partitionCard(card);
    if (parts.length > 1) splitCards.push({ sourceCardId: card.id, generatedCardIds: parts.map((part) => part.id) });
    return parts;
  });
  const fittedPlan = { ...withPolicy, cards };
  const cardDiagnostics = cards.map(estimateCardLayout);
  return {
    plan: fittedPlan,
    diagnostics: {
      mode,
      originalCardCount: plan.cards.length,
      finalCardCount: cards.length,
      splitCards,
      cards: cardDiagnostics,
      valid: cardDiagnostics.every((card) => card.fits),
    },
  };
}

export function fixedCardPlanPrompt(mode: CardLayoutMode): string {
  if (mode === "free") return "布局模式为自由生成：按任务语义选择自然密度和布局。";
  return [
    "布局模式为固定卡片：每张 GeneratedCard 的完整外框固定为 600×300px，包含标题、正文和动作；卡内禁止滚动。",
    `从 CardPlan 阶段就执行空间装箱：标题区 ${FIXED_CARD_HEADER_HEIGHT}px，正文区 ${FIXED_CARD_BODY_HEIGHT}px，其中可用内容高度约 ${FIXED_CARD_CONTENT_HEIGHT}px；每卡最多2个内容块、4个列表项、3个指标、2个动作。`,
    "优先保留结论、关键事实和动作，删除重复措辞。内容放不下时按独立主题拆成更多卡片；卡片总数不设固定上限，但禁止为了装饰拆卡。",
    "动作尽量同一行。不得用卡内滚动、折叠重要事实或隐藏关键内容来规避空间限制。",
  ].join("\n");
}

export function fixedOpenUILayoutPrompt(mode: CardLayoutMode): string {
  if (mode === "free") return "";
  return [
    "FIXED CARD CANVAS: every GeneratedCard is exactly 600x300 CSS pixels including its header, body, media, and actions; card-internal scrolling is forbidden.",
    "Every card body reference MUST be FixedCardContent([primary, optionalSecondary], optionalActions). Use only FixedFacts, FixedList, FixedMetrics, FixedTimeline, FixedComparison, FixedMedia, FixedGallery and FixedActions inside it.",
    "Use one principal bounded component, at most one compact secondary component, and at most one FixedActions row. Never use generic Stack/TextContent, Table, charts, Tabs, Accordion, Carousel, CodeBlock, Form or nested Card in fixed mode.",
    "Do not solve space pressure with hidden overflow, truncation, tiny text, or nested scrolling. Every supplied fact and action must remain visibly represented.",
  ].join("\n");
}
