import type { CardPlan } from "@/dsl/modules";
import { conciseCardTitle } from "./cardTitle";
import { cardPlanLayoutMode } from "./layoutPolicy";

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
  const fixed = cardPlanLayoutMode(cardPlan) === "fixed-600x300";
  const bodyRefs = cardPlan.cards.map((card, index) => ({
    cardId: card.id,
    cardRef: `card_${index}`,
    bodyRef: `card_${index}_body`,
  }));
  const rootChildren = bodyRefs.map((item) => item.cardRef).join(", ");
  const firstArchetype = cardPlan.cards[0]?.presentation?.archetype;
  const layout = fixed ? "deck" : cardPlan.cards.length >= 3 && (firstArchetype === "hero" || firstArchetype === "media")
    ? "featured"
    : cardPlan.cards.length >= 3 ? "deck" : "auto";
  const lines = [`root = CardDeck([${rootChildren}], ${JSON.stringify(layout)})`];

  cardPlan.cards.forEach((card, index) => {
    const ref = bodyRefs[index];
    const variant = card.presentation?.archetype ?? "standard";
    const density = fixed ? "compact" : card.presentation?.density ?? "balanced";
    lines.push(`${ref.cardRef} = GeneratedCard(${JSON.stringify(card.id)}, ${JSON.stringify(conciseCardTitle(card.title ?? card.purpose, `卡片 ${index + 1}`))}, [${ref.bodyRef}], ${JSON.stringify(variant)}, ${JSON.stringify(density)})`);
  });

  return { code: lines.join("\n"), bodyRefs };
}
