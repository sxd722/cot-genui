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
  const lines = [`root = CardDeck([${rootChildren}])`];

  cardPlan.cards.forEach((card, index) => {
    const ref = bodyRefs[index];
    lines.push(`${ref.cardRef} = GeneratedCard(${JSON.stringify(card.id)}, ${JSON.stringify(card.purpose)}, [${ref.bodyRef}])`);
  });

  return { code: lines.join("\n"), bodyRefs };
}
