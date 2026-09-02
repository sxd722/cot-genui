import type { CardPlan } from "@/dsl/modules";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStitchCardPlan(value: unknown): CardPlan | null {
  if (!isRecord(value) || typeof value.skillName !== "string" || typeof value.reasoning !== "string" || !Array.isArray(value.cards) || !value.cards.length) {
    return null;
  }
  const cardsAreValid = value.cards.every((card) => {
    if (!isRecord(card) || typeof card.id !== "string" || typeof card.purpose !== "string" || !Array.isArray(card.blocks)) return false;
    if (card.title !== undefined && typeof card.title !== "string") return false;
    if (card.actions !== undefined && !Array.isArray(card.actions)) return false;
    return card.blocks.every((block) => isRecord(block)
      && typeof block.kind === "string"
      && (block.items === undefined || Array.isArray(block.items))
      && (block.metrics === undefined || Array.isArray(block.metrics))
      && (block.options === undefined || Array.isArray(block.options)));
  });
  return cardsAreValid ? value as unknown as CardPlan : null;
}
