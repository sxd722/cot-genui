import type { CardPlan } from "@/dsl/modules";

function scrub(value: unknown): string {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s<>()\]]+/gi, "[宿主外链]")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function sourceMaterial(cardPlan: CardPlan, query?: string) {
  return {
    topic: scrub(query) || scrub(cardPlan.skillName),
    sourceSections: cardPlan.cards.map((card) => {
      const facts: string[] = [];
      const metrics: Array<{ label: string; value: number; unit?: string }> = [];
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
            ...(metric.unit ? { unit: scrub(metric.unit) } : {}),
          });
        }
        for (const option of block.options ?? []) {
          const text = scrub(option);
          if (text) options.push(text);
        }
      }

      return {
        title: scrub(card.title) || scrub(card.purpose),
        context: scrub(card.purpose),
        facts: [...new Set(facts)],
        metrics,
        options: [...new Set(options)],
        actions: (card.actions ?? []).map((action) => ({ label: scrub(action.label) })),
      };
    }),
  };
}

/**
 * Give Stitch factual source material, not the host's OpenUI design brief.
 * Stitch owns the complete visual language, composition, and page topology.
 */
export function buildStitchPrompt(cardPlan: CardPlan, query?: string): string {
  const fixedLayout = cardPlan.layoutPolicy?.mode === "fixed-600x300";
  const layoutInstructions = fixedLayout
    ? `FIXED CARD CONTRACT

Create exactly ${cardPlan.cards.length} top-level visual ${cardPlan.cards.length === 1 ? "card" : "cards"}, one for each source section. Preserve the source section order and do not merge, split, add, or remove cards.

Every card must be exactly 600px wide and exactly 300px high, including its border. Set width, min-width, and max-width to 600px; set height, min-height, and max-height to 300px; use border-box sizing.

No content may overflow, clip, or scroll inside a card. Do not use internal scroll containers. Fit all supplied content through clear hierarchy and compact composition without hiding facts or actions. The surrounding deck may arrange or horizontally scroll the fixed-size cards as needed.`
    : `Freely decide the visual language, layout, and page structure according to the subject matter.
You own typography, color, spacing, hierarchy, imagery, icons, motion, interaction, responsive behavior, and the overall composition.

You may merge, split, reorder, or reframe the source sections. You may choose whether the result uses cards, editorial sections, a dashboard, a narrative page, or another suitable form. Do not preserve the source section count merely because it is grouped that way.`;

  return `
Create a complete, polished, responsive web experience for the topic below.

All visible user-facing UI text must use Simplified Chinese. Translate generic labels and interface microcopy into natural Simplified Chinese. Preserve unavoidable proper nouns, model names, codes, and user-supplied identifiers only when translation would change their meaning.

Use the source material as factual grounding, not as a design specification or layout schema.

${layoutInstructions}

Keep the supplied facts and action meanings accurate. Do not expose internal metadata, invent URLs, or add unsupported factual claims. Neutral interface microcopy is allowed when it helps the experience.

SOURCE MATERIAL

${JSON.stringify(sourceMaterial(cardPlan, query), null, 2)}
`.trim();
}
