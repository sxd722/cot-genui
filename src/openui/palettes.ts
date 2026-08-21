import type { TaskFamily } from "@/lib/adaptive/types";

export type CompactPaletteName = "general" | "planning" | "recommendation" | "analysis";

export interface OpenUIPalette {
  name: CompactPaletteName | "expanded";
  components: readonly string[];
}

export const COMPACT_PALETTES: Record<CompactPaletteName, OpenUIPalette> = {
  general: { name: "general", components: ["CardDeck", "GeneratedCard", "TextContent", "Stack", "Callout", "TagBlock", "Table", "Col", "Tabs", "TabItem", "Accordion", "AccordionItem", "MetricRow", "Timeline", "RecommendationGrid", "ComparisonGrid", "MediaHero", "AssetImage", "AssetGallery", "ActionPanel", "HostActionChip", "HostActionItem"] },
  planning: { name: "planning", components: ["CardDeck", "GeneratedCard", "TextContent", "Stack", "Callout", "TagBlock", "Steps", "StepsItem", "Tabs", "TabItem", "Timeline", "MetricRow", "MediaHero", "AssetImage", "AssetGallery", "ActionPanel", "HostActionChip", "HostActionItem"] },
  recommendation: { name: "recommendation", components: ["CardDeck", "GeneratedCard", "TextContent", "Stack", "Callout", "TagBlock", "Table", "Col", "Tabs", "TabItem", "Carousel", "RecommendationGrid", "ComparisonGrid", "MetricRow", "MediaHero", "AssetImage", "AssetGallery", "ActionPanel", "HostActionChip", "HostActionItem", "HostActionMenu", "Separator"] },
  analysis: { name: "analysis", components: ["CardDeck", "GeneratedCard", "TextContent", "Stack", "Callout", "TagBlock", "Table", "Col", "MetricRow", "BarChart", "LineChart", "AreaChart", "PieChart", "Series", "Slice", "ComparisonGrid", "ActionPanel", "HostActionChip", "HostActionItem", "Separator", "AssetImage", "AssetGallery"] },
};

export const EXPANDED_PALETTE: OpenUIPalette = {
  name: "expanded",
  components: [
    "CardDeck", "GeneratedCard", "TextContent", "MarkDownRenderer", "Stack", "Card", "CardHeader", "Callout", "TextCallout", "TagBlock", "Separator",
    "Table", "Col", "MetricRow", "BarChart", "LineChart", "AreaChart", "PieChart", "RadarChart", "Series", "Slice",
    "Steps", "StepsItem", "Timeline", "Tabs", "TabItem", "Accordion", "AccordionItem", "Carousel",
    "RecommendationGrid", "ComparisonGrid", "MediaHero", "AssetImage", "AssetGallery", "ActionPanel",
    "HostActionChip", "HostActionItem", "HostActionMenu", "HostActionList", "MediaActionTile",
  ],
};

export function compactPalettes(): OpenUIPalette[] {
  return Object.values(COMPACT_PALETTES);
}

export function paletteNameForTaskFamily(family: TaskFamily): CompactPaletteName {
  if (family === "planning") return "planning";
  if (family === "recommendation" || family === "decision") return "recommendation";
  if (family === "analysis" || family === "information") return "analysis";
  return "general";
}
