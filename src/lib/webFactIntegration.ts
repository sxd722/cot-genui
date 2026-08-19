import type { CardPlan } from "@/dsl/modules";

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Web facts are optional evidence. The host only enforces link safety and never
 * adds cards, content, actions, or source sections on the model's behalf.
 */
export function sanitizeCardPlanExternalLinks(plan: CardPlan, allowedUrls: ReadonlySet<string>): CardPlan {
  return {
    ...plan,
    cards: plan.cards.map((card) => ({
      ...card,
      blocks: card.blocks.map((block) => ({
        ...block,
        items: block.items?.map((item) => ({ ...item })),
      })),
      actions: card.actions?.filter((action) => {
        if (action.type !== "external-link") return true;
        const link = validHttpUrl(action.link);
        return !!link && allowedUrls.has(link);
      }).map((action) => ({ ...action })),
    })),
  };
}
