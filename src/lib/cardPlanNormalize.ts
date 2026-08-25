import type { CardNode, CardPresentationIntent, IRBlock } from "@/dsl/modules";

const ARCHETYPES = new Set(["standard", "hero", "editorial", "comparison", "timeline", "data", "action", "media"]);
const DENSITIES = new Set(["compact", "balanced", "immersive"]);
const EMPHASES = new Set(["content", "data", "media", "action"]);
const ASPECTS = new Set(["wide", "square", "portrait"]);

/** Normalize stable, unique IDs without imposing a card-count ceiling. */
export function normalizeCardSequence(cards: CardNode[]): CardNode[] {
  const usedCardIds = new Set<string>();
  return cards.map((card, cardIndex) => {
    const baseId = typeof card.id === "string" && card.id.trim() ? card.id.trim() : `card_${cardIndex + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedCardIds.has(id)) id = `${baseId}_${suffix++}`;
    usedCardIds.add(id);
    return { ...card, id };
  });
}

export function normalizeCardPresentation(value: unknown): CardPresentationIntent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.archetype !== "string" || !ARCHETYPES.has(raw.archetype)) return undefined;
  if (raw.density !== undefined && (typeof raw.density !== "string" || !DENSITIES.has(raw.density))) return undefined;
  if (raw.emphasis !== undefined && (typeof raw.emphasis !== "string" || !EMPHASES.has(raw.emphasis))) return undefined;
  return {
    archetype: raw.archetype as CardPresentationIntent["archetype"],
    ...(raw.density ? { density: raw.density as CardPresentationIntent["density"] } : {}),
    ...(raw.emphasis ? { emphasis: raw.emphasis as CardPresentationIntent["emphasis"] } : {}),
  };
}

export function normalizeAssetRequest(value: unknown): IRBlock["assetRequest"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "image" && raw.kind !== "gallery") return undefined;
  if (raw.role !== "hero" && raw.role !== "supporting" && raw.role !== "gallery") return undefined;
  if (typeof raw.query !== "string" || !raw.query.trim()) return undefined;
  const count = Math.max(1, Math.min(6, Math.round(Number(raw.count) || 1)));
  return {
    kind: raw.kind,
    query: raw.query.replace(/[\r\n]+/g, " ").trim().slice(0, 160),
    count,
    role: raw.role,
    ...(typeof raw.aspect === "string" && ASPECTS.has(raw.aspect) ? { aspect: raw.aspect as NonNullable<IRBlock["assetRequest"]>["aspect"] } : {}),
  };
}
