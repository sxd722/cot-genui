import type { CardPlan, CardPresentationIntent } from "@/dsl/modules";
import { openUIActionRef } from "./actionRefs";
import { safeAssetRefs, type AssetManifest, type SafeAssetRef } from "./assetTypes";
import { cardPlanLayoutMode, estimateCardLayout, FIXED_CARD_CONTENT_HEIGHT, FIXED_CARD_HEIGHT, FIXED_CARD_WIDTH } from "./layoutPolicy";

/**
 * Step-6 model protocol. This is the machine-facing replacement for
 * cardPlanToVibeMarkdown(): renderableContent is the only text that may
 * become visible UI; designIntent is bounded, non-renderable metadata;
 * assets and actions are safe references only.
 */

export interface OpenUIDesignBrief {
  layout: {
    mode: "fixed-600x300" | "free";
    cardWidth?: number;
    cardHeight?: number;
    innerScroll?: false;
    maxContentHeightPx?: number;
  };
  cards: OpenUICardDesignBrief[];
}

export interface OpenUICardDesignBrief {
  id: string;
  purpose: string;
  layoutBudget?: {
    estimatedHeightPx: number;
    maxContentHeightPx: number;
    contentSlots: number;
  };
  allowedCompositions?: Array<"facts" | "list" | "metrics" | "timeline" | "comparison" | "media" | "actions">;

  /** ONLY content that may appear visibly in the final UI. */
  renderableContent: {
    facts: string[];
    metrics: Array<{
      label: string;
      value: string | number;
      unit?: string;
    }>;
    options: string[];
  };

  /** NON-RENDERABLE metadata. Never copy verbatim into visible UI. */
  designIntent?: {
    archetype?: CardPresentationIntent["archetype"];
    density?: CardPresentationIntent["density"];
    emphasis?: CardPresentationIntent["emphasis"];
  };

  availableAssets: SafeAssetRef[];

  actions: Array<{
    actionRef: string;
    label: string;
    type: string;
    role?: "primary" | "secondary" | "tertiary";
  }>;
}

function scrub(value: unknown): string {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s<>()\]]+/gi, "[宿主外链]")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function designIntentOf(presentation?: CardPresentationIntent): OpenUICardDesignBrief["designIntent"] {
  if (!presentation) return undefined;
  return {
    archetype: presentation.archetype,
    ...(presentation.density ? { density: presentation.density } : {}),
    ...(presentation.emphasis ? { emphasis: presentation.emphasis } : {}),
  };
}

export function buildOpenUIDesignBrief(cardPlan: CardPlan, assetManifest?: AssetManifest): OpenUIDesignBrief {
  const availableAssets = assetManifest ? safeAssetRefs(assetManifest) : [];
  const layoutMode = cardPlanLayoutMode(cardPlan);
  return {
    layout: layoutMode === "fixed-600x300"
      ? { mode: layoutMode, cardWidth: FIXED_CARD_WIDTH, cardHeight: FIXED_CARD_HEIGHT, innerScroll: false, maxContentHeightPx: FIXED_CARD_CONTENT_HEIGHT }
      : { mode: layoutMode },
    cards: cardPlan.cards.map((card) => {
      const facts: string[] = [];
      const metrics: NonNullable<OpenUICardDesignBrief["renderableContent"]["metrics"]> = [];
      const options: string[] = [];
      for (const block of card.blocks) {
        for (const value of [block.title, block.text, block.detail, block.value]) {
          const text = scrub(value);
          if (text) facts.push(text);
        }
        for (const item of block.items ?? []) {
          const label = scrub(item.label);
          const detail = scrub(item.detail);
          const line = [label, detail].filter(Boolean).join(" — ");
          if (line) facts.push(line);
        }
        for (const metric of block.metrics ?? []) {
          metrics.push({
            label: scrub(metric.label),
            value: metric.value,
            ...(metric.unit ? { unit: metric.unit } : {}),
          });
        }
        for (const option of block.options ?? []) {
          const text = scrub(option);
          if (text) options.push(text);
        }
      }
      const layout = estimateCardLayout(card);
      const allowedCompositions: NonNullable<OpenUICardDesignBrief["allowedCompositions"]> = [];
      if (card.blocks.some((block) => block.assetRequest || block.kind === "image" || block.kind === "infographic")) allowedCompositions.push("media");
      if (card.blocks.some((block) => block.items?.length)) allowedCompositions.push(card.presentation?.archetype === "timeline" ? "timeline" : "list");
      if (card.blocks.some((block) => block.metrics?.length)) allowedCompositions.push("metrics");
      if (card.presentation?.archetype === "comparison") allowedCompositions.push("comparison");
      if (facts.length) allowedCompositions.push("facts");
      if (card.actions?.length) allowedCompositions.push("actions");
      return {
        id: card.id,
        purpose: scrub(card.purpose),
        ...(layoutMode === "fixed-600x300" ? {
          layoutBudget: { estimatedHeightPx: layout.estimatedHeightPx, maxContentHeightPx: layout.maxHeightPx, contentSlots: layout.contentSlots },
          allowedCompositions: [...new Set(allowedCompositions)],
        } : {}),
        renderableContent: {
          facts: [...new Set(facts)],
          metrics,
          options: [...new Set(options)],
        },
        ...(designIntentOf(card.presentation) ? { designIntent: designIntentOf(card.presentation) } : {}),
        availableAssets: availableAssets.filter((asset) => asset.cardId === card.id),
        actions: (card.actions ?? []).map((action) => ({
          actionRef: openUIActionRef(card.id, action.id),
          label: scrub(action.label),
          type: action.type,
          ...(action.role ? { role: action.role } : {}),
        })),
      };
    }),
  };
}
