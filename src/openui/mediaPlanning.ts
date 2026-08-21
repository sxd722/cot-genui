import type { CardPlan, CardNode, IRBlock } from "@/dsl/modules";
import { assetRequestId } from "./assetTypes";

export interface MediaPlanningDiagnosticItem {
  requestId: string;
  cardId: string;
  blockIndex: number;
  query: string;
  role: "hero" | "supporting" | "gallery";
  aspect: "wide" | "square" | "portrait";
}

export interface MediaPlanningDiagnostics {
  modelDeclared: number;
  synthesized: number;
  synthesizedRequests: MediaPlanningDiagnosticItem[];
}

export interface EnsuredAssetRequests {
  plan: CardPlan;
  diagnostics: MediaPlanningDiagnostics;
}

const IMAGE_WORDS = /(图片|照片|实景|环境图|配图|图像|相册|画廊|视觉|photo|image|gallery)/i;
const VISUAL_ENTITY_WORDS = /(酒店|民宿|目的地|景点|建筑|空间|室内|商品|产品|服装|菜品|菜单|人物|肖像|动物|植物|艺术|画作|雕塑|书封|封面|海报|邀请函|设计成品|泳池|庭院|海滨|湿地|古镇)/i;
const PORTRAIT_WORDS = /(人物|肖像|人像|模特|穿搭|全身|竖版|海报|书封|封面)/i;
const PURE_NON_VISUAL_WORDS = /(代码|接口|流程|步骤|预算|同比|指标|公式|抽象分析|日志|错误|配置|数据表)/i;

function textOfBlock(block: IRBlock): string {
  return [
    block.title,
    block.text,
    block.detail,
    block.value,
    ...(block.items ?? []).flatMap((item) => [item.label, item.detail]),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("，")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function queryForBlock(block: IRBlock): string {
  if (block.kind === "list" && block.items?.length) {
    return [block.items[0].label, block.items[0].detail]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join("，")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 140);
  }
  return textOfBlock(block);
}

function isPureDataCard(card: CardNode): boolean {
  const body = `${card.title ?? ""} ${card.purpose} ${card.blocks.map(textOfBlock).join(" ")}`;
  const onlyDataKinds = card.blocks.length > 0 && card.blocks.every((block) => ["metric", "chart", "progress", "status", "toggle", "choice"].includes(block.kind));
  return (onlyDataKinds || PURE_NON_VISUAL_WORDS.test(body)) && !VISUAL_ENTITY_WORDS.test(body) && !IMAGE_WORDS.test(body);
}

function cardMediaScore(card: CardNode, explicitUserImage: boolean): number {
  if (isPureDataCard(card)) return -100;
  let score = 0;
  if (IMAGE_WORDS.test(card.purpose)) score += 8;
  if (card.presentation?.archetype === "media") score += 7;
  if (card.presentation?.emphasis === "media") score += 6;
  if (card.blocks.some((block) => block.kind === "image" || block.kind === "hero")) score += 3;
  const body = `${card.title ?? ""} ${card.purpose} ${card.blocks.map(textOfBlock).join(" ")}`;
  if (VISUAL_ENTITY_WORDS.test(body)) score += 4;
  if (explicitUserImage) score += 2;
  return score;
}

function blockScore(block: IRBlock, index: number): number {
  if (block.assetRequest) return -100;
  const text = textOfBlock(block);
  if (!text) return -100;
  let score = block.kind === "hero" ? 8 : block.kind === "image" ? 7 : block.kind === "summary" ? 5 : block.kind === "list" ? 3 : 1;
  if (VISUAL_ENTITY_WORDS.test(text)) score += 5;
  if (IMAGE_WORDS.test(text)) score += 3;
  return score - index / 100;
}

function aspectFor(block: IRBlock, text: string): "wide" | "square" | "portrait" {
  if (PORTRAIT_WORDS.test(text)) return "portrait";
  if (block.kind === "list") return "square";
  return "wide";
}

/**
 * Deterministic, zero-LLM safety net for media intent omitted by Step 5.
 * It only annotates existing blocks and therefore cannot change card topology.
 */
export function ensureAssetRequests(plan: CardPlan, userQuery: string): EnsuredAssetRequests {
  const modelDeclared = plan.cards.reduce((count, card) => count + card.blocks.filter((block) => !!block.assetRequest).length, 0);
  const explicitUserImage = IMAGE_WORDS.test(userQuery);
  const rankedCards = plan.cards
    .map((card, cardIndex) => ({ card, cardIndex, score: cardMediaScore(card, explicitUserImage) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.cardIndex - b.cardIndex);
  const strongMediaCards = rankedCards.filter((entry) => entry.score >= 8);
  const selectedCards = strongMediaCards.length ? strongMediaCards : rankedCards.slice(0, 1);
  const selectedIds = new Set(selectedCards.map((entry) => entry.card.id));
  let remaining = 2;
  const synthesizedRequests: MediaPlanningDiagnosticItem[] = [];

  const cards = plan.cards.map((card) => {
    if (!selectedIds.has(card.id) || remaining === 0) return card;
    const rankedBlocks = card.blocks
      .map((block, blockIndex) => ({ blockIndex, score: blockScore(block, blockIndex) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.blockIndex - b.blockIndex);
    const chosen = new Set(rankedBlocks.slice(0, remaining).map((entry) => entry.blockIndex));
    const existingOnCard = card.blocks.filter((block) => !!block.assetRequest).length;
    const blocks = card.blocks.map((block, blockIndex) => {
      if (!chosen.has(blockIndex) || block.assetRequest || remaining === 0) return block;
      const query = queryForBlock(block);
      if (!query) return block;
      const role = block.kind === "hero" || (existingOnCard === 0 && synthesizedRequests.filter((item) => item.cardId === card.id).length === 0)
        ? "hero" as const
        : "supporting" as const;
      const aspect = aspectFor(block, query);
      const requestId = assetRequestId(card.id, blockIndex);
      synthesizedRequests.push({ requestId, cardId: card.id, blockIndex, query, role, aspect });
      remaining -= 1;
      return { ...block, assetRequest: { kind: "image" as const, query, count: 1, role, aspect } };
    });
    return { ...card, blocks };
  });

  return {
    plan: { ...plan, cards },
    diagnostics: {
      modelDeclared,
      synthesized: synthesizedRequests.length,
      synthesizedRequests,
    },
  };
}
