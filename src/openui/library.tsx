"use client";

import { createLibrary } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { CardDeck } from "./components/CardDeck";
import { GeneratedCard } from "./components/GeneratedCard";
import { HostActionChip, HostActionItem, HostActionList, HostActionMenu, MediaActionTile } from "./components/HostActions";
import { MetricRow } from "./components/MetricRow";
import { Timeline } from "./components/Timeline";
import { RecommendationGrid } from "./components/RecommendationGrid";
import { ComparisonGrid } from "./components/ComparisonGrid";
import { MediaHero } from "./components/MediaHero";
import { ActionPanel } from "./components/ActionPanel";
import { AssetImage } from "./components/AssetImage";
import { AssetGallery } from "./components/AssetGallery";
import { FIXED_LAYOUT_COMPONENTS } from "./components/FixedLayout";

export const cotGenUILibrary = createLibrary({
  id: "cot-genui-carddeck-v1",
  root: "CardDeck",
  components: [
    ...Object.values(openuiLibrary.components),
    GeneratedCard,
    CardDeck,
    MetricRow,
    Timeline,
    RecommendationGrid,
    ComparisonGrid,
    MediaHero,
    ActionPanel,
    AssetImage,
    AssetGallery,
    ...FIXED_LAYOUT_COMPONENTS,
    HostActionChip,
    HostActionItem,
    HostActionMenu,
    HostActionList,
    MediaActionTile,
  ],
  componentGroups: [
    ...(openuiLibrary.componentGroups ?? []),
    {
      name: "Generated Card Deck",
      components: ["CardDeck", "GeneratedCard", "MetricRow", "Timeline", "RecommendationGrid", "ComparisonGrid", "MediaHero", "AssetImage", "AssetGallery", "ActionPanel", "HostActionChip", "HostActionItem", "HostActionMenu", "HostActionList", "MediaActionTile"],
      notes: [
        "CardDeck is the only root.",
        "GeneratedCard is the only peer card boundary.",
        "HostAction components must receive actionRef values supplied by the host.",
        "Prefer a semantic component when it directly represents the content pattern.",
        "AssetImage and AssetGallery accept only host-supplied assetRef IDs, never URLs.",
      ],
    },
    {
      name: "Fixed 600x300 Card Layout",
      components: ["FixedCardContent", "FixedFacts", "FixedList", "FixedMetrics", "FixedTimeline", "FixedComparison", "FixedMedia", "FixedGallery", "FixedActions"],
      notes: ["Use these components only when the host selects fixed-600x300 mode.", "FixedCardContent is the required body grammar and keeps all content visible without internal scrolling."],
    },
  ],
});

export const library = cotGenUILibrary;
export { promptOptions } from "./promptOptions";
