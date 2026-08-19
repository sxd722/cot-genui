import { createParser, type ElementNode, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import type { CardPlan } from "@/dsl/modules";
import librarySpecJson from "./generated/system-prompt.spec.json";

export const OPENUI_PRIMITIVES = new Set([
  "TextContent",
  "Stack",
  "Card",
  "CardHeader",
  "Separator",
]);

export const OPENUI_MEDIA_COMPONENTS = new Set([
  "Image",
  "ImageBlock",
  "ImageGallery",
  "MediaActionTile",
  "MediaHero",
  "AssetImage",
  "AssetGallery",
]);

export const OPENUI_INTERACTION_COMPONENTS = new Set([
  "Button",
  "Tabs",
  "Accordion",
  "Carousel",
  "Checkbox",
  "Input",
  "Select",
  "Slider",
  "Switch",
  "HostActionChip",
  "HostActionItem",
  "HostActionMenu",
  "HostActionList",
  "ActionPanel",
]);

export interface OpenUIQualityMetrics {
  cardCount: number;
  uniqueComponents: string[];
  uniqueComponentCount: number;
  primitiveStatementCount: number;
  semanticStatementCount: number;
  primitiveRatio: number;
  mediaComponentCount: number;
  interactionComponentCount: number;
  generatedCardVariants: string[];
}

const librarySpec = librarySpecJson as LibrarySpec;

function isElementNode(value: unknown): value is ElementNode {
  return !!value && typeof value === "object" && (value as Partial<ElementNode>).type === "element";
}

function walkElement(value: unknown, visit: (node: ElementNode) => void, seen: Set<ElementNode>) {
  if (isElementNode(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    visit(value);
    Object.values(value.props).forEach((child) => walkElement(child, visit, seen));
    return;
  }
  if (Array.isArray(value)) value.forEach((child) => walkElement(child, visit, seen));
}

function zeroMetrics(): OpenUIQualityMetrics {
  return {
    cardCount: 0,
    uniqueComponents: [],
    uniqueComponentCount: 0,
    primitiveStatementCount: 0,
    semanticStatementCount: 0,
    primitiveRatio: 0,
    mediaComponentCount: 0,
    interactionComponentCount: 0,
    generatedCardVariants: [],
  };
}

/** Parser-backed analyzer. Incomplete streaming code intentionally degrades to zeroes. */
export function analyzeOpenUIQuality(code: string, cardPlan: CardPlan): OpenUIQualityMetrics {
  void cardPlan;
  try {
    const parsed = createParser(librarySpec.schema as LibraryJSONSchema).parse(code);
    if (!parsed.root || parsed.meta.incomplete) return zeroMetrics();
    const componentNames: string[] = [];
    const variants: string[] = [];
    let cardCount = 0;
    let primitiveStatementCount = 0;
    let semanticStatementCount = 0;
    let mediaComponentCount = 0;
    let interactionComponentCount = 0;
    walkElement(parsed.root, (node) => {
      componentNames.push(node.typeName);
      if (node.typeName === "GeneratedCard") {
        cardCount += 1;
        variants.push(String(node.props.variant ?? "standard"));
        return;
      }
      if (node.typeName === "CardDeck") return;
      if (OPENUI_PRIMITIVES.has(node.typeName)) primitiveStatementCount += 1;
      else semanticStatementCount += 1;
      if (OPENUI_MEDIA_COMPONENTS.has(node.typeName)) mediaComponentCount += 1;
      if (OPENUI_INTERACTION_COMPONENTS.has(node.typeName)) interactionComponentCount += 1;
    }, new Set());
    const denominator = primitiveStatementCount + semanticStatementCount;
    const uniqueComponents = [...new Set(componentNames)].sort();
    return {
      cardCount,
      uniqueComponents,
      uniqueComponentCount: uniqueComponents.length,
      primitiveStatementCount,
      semanticStatementCount,
      primitiveRatio: denominator ? primitiveStatementCount / denominator : 0,
      mediaComponentCount,
      interactionComponentCount,
      generatedCardVariants: variants,
    };
  } catch {
    return zeroMetrics();
  }
}
