import type { CardPlan } from "@/dsl/modules";

export interface OpenUIBootstrapBodyRef {
  cardId: string;
  cardRef: string;
  bodyRef: string;
}

export interface OpenUIBootstrap {
  code: string;
  bodyRefs: OpenUIBootstrapBodyRef[];
}

export function buildOpenUIBootstrap(cardPlan: CardPlan): OpenUIBootstrap {
  const bodyRefs = cardPlan.cards.map((card, index) => ({
    cardId: card.id,
    cardRef: `card_${index}`,
    bodyRef: `card_${index}_body`,
  }));
  const rootChildren = bodyRefs.map((item) => item.cardRef).join(", ");
  const firstArchetype = cardPlan.cards[0]?.presentation?.archetype;
  const layout = cardPlan.cards.length >= 3 && (firstArchetype === "hero" || firstArchetype === "media")
    ? "featured"
    : cardPlan.cards.length >= 3 ? "deck" : "auto";
  const lines = [`root = CardDeck([${rootChildren}], ${JSON.stringify(layout)})`];

  cardPlan.cards.forEach((card, index) => {
    const ref = bodyRefs[index];
    const variant = card.presentation?.archetype ?? "standard";
    const density = card.presentation?.density ?? "balanced";
    lines.push(`${ref.cardRef} = GeneratedCard(${JSON.stringify(card.id)}, ${JSON.stringify(card.purpose)}, [${ref.bodyRef}], ${JSON.stringify(variant)}, ${JSON.stringify(density)})`);
  });

  return { code: lines.join("\n"), bodyRefs };
}
