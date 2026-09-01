import type { CardNode, CardPlan, IRBlock } from "@/dsl/modules";

export type CardPlanEnvelopeSource = "cardPlan" | "card_plan" | "plan" | "root" | "none";

export interface CardPlanEnvelopeDiagnostics {
  stage: "cardplan_shape";
  valid: boolean;
  source: CardPlanEnvelopeSource;
  repairs: string[];
  issues: string[];
  topLevelKeys: string[];
  cardPlanKeys: string[];
  cardCount: number;
}

export interface CardPlanEnvelopeResult {
  plan: CardPlan | null;
  outerReasoning?: string;
  diagnostics: CardPlanEnvelopeDiagnostics;
}

interface CardPlanFallbacks {
  skillName: string;
  reasoning: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function candidateFrom(root: Record<string, unknown>): { source: CardPlanEnvelopeSource; value: Record<string, unknown> | null } {
  for (const [key, source] of [
    ["cardPlan", "cardPlan"],
    ["card_plan", "card_plan"],
    ["plan", "plan"],
  ] as const) {
    const candidate = record(root[key]);
    if (candidate) return { source, value: candidate };
  }
  if (Array.isArray(root.cards)) return { source: "root", value: root };
  return { source: "none", value: null };
}

function normalizeBlocks(card: Record<string, unknown>, index: number, repairs: string[]): IRBlock[] {
  if (Array.isArray(card.blocks)) {
    return card.blocks.filter((block) => !!record(block)) as IRBlock[];
  }
  if (Array.isArray(card.content)) {
    repairs.push(`card_${index + 1}_blocks_from_content`);
    return card.content.filter((block) => !!record(block)) as IRBlock[];
  }
  const text = nonEmptyString(card.text) ?? nonEmptyString(card.summary) ?? nonEmptyString(card.content);
  if (text) {
    repairs.push(`card_${index + 1}_summary_block_synthesized`);
    return [{ kind: "summary", text }];
  }
  repairs.push(`card_${index + 1}_empty_blocks_synthesized`);
  return [];
}

/**
 * Repairs only common envelope/required-field drift from smaller models.
 * Semantic content, topology, actions, and media declarations remain model-owned.
 */
export function normalizeCardPlanEnvelope(value: unknown, fallbacks: CardPlanFallbacks): CardPlanEnvelopeResult {
  const root = record(value);
  const repairs: string[] = [];
  const issues: string[] = [];
  const topLevelKeys = root ? Object.keys(root).slice(0, 30) : [];
  const outerReasoning = root ? nonEmptyString(root.reasoning) : undefined;
  const selected = root ? candidateFrom(root) : { source: "none" as const, value: null };
  const candidate = selected.value;

  if (!root) issues.push("response_not_object");
  if (!candidate) issues.push("cardplan_envelope_missing");

  const rawCards = candidate?.cards;
  if (!Array.isArray(rawCards) || rawCards.length === 0) issues.push("cards_missing_or_empty");
  const usableCards = Array.isArray(rawCards) ? rawCards.filter((card) => !!record(card)) : [];
  if (Array.isArray(rawCards) && usableCards.length !== rawCards.length) repairs.push("non_object_cards_removed");
  if (Array.isArray(rawCards) && usableCards.length === 0) issues.push("cards_have_no_objects");

  const diagnosticsBase = {
    stage: "cardplan_shape" as const,
    source: selected.source,
    repairs,
    issues,
    topLevelKeys,
    cardPlanKeys: candidate ? Object.keys(candidate).slice(0, 30) : [],
    cardCount: usableCards.length,
  };
  if (!candidate || issues.length > 0) {
    return { plan: null, outerReasoning, diagnostics: { ...diagnosticsBase, valid: false } };
  }

  let skillName = nonEmptyString(candidate.skillName);
  if (!skillName) {
    skillName = nonEmptyString(candidate.name) ?? nonEmptyString(candidate.title);
    if (skillName) repairs.push("skillName_from_name");
    else {
      skillName = fallbacks.skillName;
      repairs.push("skillName_synthesized");
    }
  }

  let reasoning = nonEmptyString(candidate.reasoning);
  if (!reasoning && outerReasoning) {
    reasoning = outerReasoning;
    repairs.push("reasoning_from_outer");
  } else if (!reasoning) {
    reasoning = fallbacks.reasoning;
    repairs.push("reasoning_synthesized");
  }

  const cards = usableCards.map((rawCard, index): CardNode => {
    const card = record(rawCard)!;
    let id = nonEmptyString(card.id);
    if (!id) {
      id = `card_${index + 1}`;
      repairs.push(`card_${index + 1}_id_synthesized`);
    }
    const title = nonEmptyString(card.title);
    let purpose = nonEmptyString(card.purpose);
    if (!purpose && title) {
      purpose = title;
      repairs.push(`card_${index + 1}_purpose_from_title`);
    } else if (!purpose) {
      purpose = `卡片 ${index + 1}`;
      repairs.push(`card_${index + 1}_purpose_synthesized`);
    }
    return {
      ...(card as unknown as CardNode),
      id,
      ...(title ? { title } : {}),
      purpose,
      blocks: normalizeBlocks(card, index, repairs),
      ...(Array.isArray(card.actions) ? { actions: card.actions as CardNode["actions"] } : { actions: undefined }),
    };
  });

  return {
    plan: {
      ...(candidate as unknown as CardPlan),
      skillName,
      reasoning,
      cards,
    },
    outerReasoning,
    diagnostics: { ...diagnosticsBase, valid: true, repairs, cardCount: cards.length },
  };
}
