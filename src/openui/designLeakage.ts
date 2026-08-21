import { createParser, type ElementNode, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import type { CardPlan } from "@/dsl/modules";
import type { OpenUIDesignBrief } from "./designBrief";
import librarySpecJson from "./generated/system-prompt.spec.json";

/**
 * Deterministic detection of non-renderable design metadata that leaked into
 * visible OpenUI text (TextContent/Callout/Table/TagBlock style string
 * literals). Small models occasionally copy authoring guidance verbatim; this
 * validator catches it so the existing repair path can strip the text.
 */

export interface DesignLeakageHit {
  cardId?: string;
  kind: "schema_label" | "design_enum" | "authoring_guidance" | "internal_identifier";
  value: string;
}

/** Labels that only exist in host-generated prompt context, never in user content. */
const FORBIDDEN_LABELS: Array<{ value: string; kind: DesignLeakageHit["kind"] }> = [
  { value: "整体创作方向", kind: "schema_label" },
  { value: "感觉与节奏", kind: "schema_label" },
  { value: "表达意图", kind: "schema_label" },
  { value: "Vibe brief", kind: "schema_label" },
  { value: "Card ID", kind: "schema_label" },
  { value: "designIntent", kind: "schema_label" },
  { value: "renderableContent", kind: "schema_label" },
  { value: "archetype", kind: "design_enum" },
  { value: "density", kind: "design_enum" },
  { value: "emphasis", kind: "design_enum" },
];

/** Authoring-guidance sentences that must never be rendered. */
const AUTHORING_PATTERNS = [
  /可以重新组织信息层级/,
  /优先让用户先看到结论/,
  /偏视觉叙事/,
  /Treat .* as a creative brief/i,
];

const librarySpec = librarySpecJson as LibrarySpec;

/** Host/control props are capabilities or layout metadata, never visible copy. */
const NON_RENDERABLE_PROPS = new Set([
  "actionRef",
  "action",
  "assetRef",
  "assetRefs",
  "cardId",
  "variant",
  "density",
  "layout",
  "direction",
  "gap",
  "align",
  "justify",
  "orientation",
  "aspect",
  "columns",
]);

function isElementNode(value: unknown): value is ElementNode {
  return !!value && typeof value === "object" && (value as Partial<ElementNode>).type === "element";
}

function collectVisibleStrings(value: unknown, result: string[], propName?: string): void {
  if (propName && NON_RENDERABLE_PROPS.has(propName)) return;
  if (typeof value === "string") {
    result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectVisibleStrings(item, result, propName));
    return;
  }
  if (!value || typeof value !== "object") return;
  const source = isElementNode(value) ? value.props : value as Record<string, unknown>;
  Object.entries(source).forEach(([key, item]) => collectVisibleStrings(item, result, key));
}

/** Parse resolved component props so actionRef/assetRef/layout strings are not mistaken for visible copy. */
function visibleTextLiterals(code: string): string[] {
  const parsed = createParser(librarySpec.schema as LibraryJSONSchema).parse(code);
  if (parsed.root) {
    const literals: string[] = [];
    collectVisibleStrings(parsed.root, literals);
    return literals;
  }

  // Invalid/incomplete programs are rejected elsewhere; retain a conservative
  // fallback so obvious authoring headings can still reach repair diagnostics.
  return [...code.matchAll(/"((?:[^"\\\r\n]|\\.)*)"/g)]
    .map((match) => match[1])
    .filter((literal) => !literal.startsWith("plan:") && !literal.startsWith("asset_"));
}

export function detectDesignMetadataLeakage(args: {
  openuiCode: string;
  cardPlan: CardPlan;
  designBrief?: OpenUIDesignBrief;
}): DesignLeakageHit[] {
  const hits: DesignLeakageHit[] = [];
  const literals = visibleTextLiterals(args.openuiCode);
  const addHit = (hit: DesignLeakageHit) => {
    if (!hits.some((current) => current.kind === hit.kind && current.value === hit.value && current.cardId === hit.cardId)) {
      hits.push(hit);
    }
  };

  for (const literal of literals) {
    const actionOwner = args.cardPlan.cards.find((card) => (card.actions ?? []).some((action) => (
      literal.includes(`plan:${encodeURIComponent(card.id)}:${encodeURIComponent(action.id)}`)
    )));
    if (actionOwner) {
      addHit({ kind: "internal_identifier", value: literal.slice(0, 80), cardId: actionOwner.id });
    }
    for (const label of FORBIDDEN_LABELS) {
      if (literal.includes(label.value)) {
        addHit({ kind: label.kind, value: literal.slice(0, 80) });
        break;
      }
    }
    if (AUTHORING_PATTERNS.some((pattern) => pattern.test(literal))) {
      addHit({ kind: "authoring_guidance", value: literal.slice(0, 80) });
      continue;
    }
    // "archetype: media" style enum dumps
    if (/^(archetype|density|emphasis)\s*[:：]\s*\S+/i.test(literal)) {
      addHit({ kind: "design_enum", value: literal.slice(0, 80) });
      continue;
    }
    // 12+ consecutive Han characters copied verbatim from brief design prose
    // (renderableContent facts may legitimately contain long Chinese text, so
    // only fire when the literal is NOT present in any renderable fact).
    const han = literal.match(/[\u4e00-\u9fff]{12,}/);
    if (han && args.designBrief) {
      const allFacts = args.designBrief.cards.flatMap((card) => card.renderableContent.facts).join("\n");
      if (!allFacts.includes(han[0])) {
        // 事实里没有这段长中文——若它来自已知非渲染指导(设计句)则命中
        if (AUTHORING_PATTERNS.some((pattern) => pattern.test(han[0]))) {
          addHit({ kind: "authoring_guidance", value: han[0].slice(0, 80) });
        }
      }
    }
  }

  return hits;
}

export function describeDesignLeakage(hits: DesignLeakageHit[]): string {
  return hits.map((hit) => `DESIGN_META_LEAK(${hit.kind}): ${hit.value}`).join("；");
}
