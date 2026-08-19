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
      components: ["CardDeck", "GeneratedCard", "MetricRow", "Timeline", "RecommendationGrid", "ComparisonGrid", "MediaHero", "ActionPanel", "HostActionChip", "HostActionItem", "HostActionMenu", "HostActionList", "MediaActionTile"],
      notes: [
        "CardDeck is the only root.",
        "GeneratedCard is the only peer card boundary.",
        "HostAction components must receive actionRef values supplied by the host.",
        "Prefer a semantic component when it directly represents the content pattern.",
      ],
    },
  ],
});

export const library = cotGenUILibrary;
export { promptOptions } from "./promptOptions";
