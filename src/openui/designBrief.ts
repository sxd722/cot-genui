import type { CardPlan, CardPresentationIntent } from "@/dsl/modules";
import { openUIActionRef } from "./actionRefs";
import { safeAssetRefs, type AssetManifest, type SafeAssetRef } from "./assetTypes";

/**
 * Step-6 model protocol. This is the machine-facing replacement for
 * cardPlanToVibeMarkdown(): renderableContent is the only text that may
 * become visible UI; designIntent is bounded, non-renderable metadata;
 * assets and actions are safe references only.
 */

export interface OpenUIDesignBrief {
  cards: OpenUICardDesignBrief[];
}

export interface OpenUICardDesignBrief {
  id: string;
  purpose: string;

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
  return {
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
      return {
        id: card.id,
        purpose: scrub(card.purpose),
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
