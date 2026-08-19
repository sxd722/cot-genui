"use client";

import { createLibrary } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { CardDeck } from "./components/CardDeck";
import { GeneratedCard } from "./components/GeneratedCard";
import { HostActionChip, HostActionItem, HostActionList, HostActionMenu, MediaActionTile } from "./components/HostActions";

export const cotGenUILibrary = createLibrary({
  id: "cot-genui-carddeck-v1",
  root: "CardDeck",
  components: [
    ...Object.values(openuiLibrary.components),
    GeneratedCard,
    CardDeck,
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
      components: ["CardDeck", "GeneratedCard", "HostActionChip", "HostActionItem", "HostActionMenu", "HostActionList", "MediaActionTile"],
      notes: [
        "CardDeck is the only root.",
        "GeneratedCard is the only peer card boundary.",
        "HostAction components must receive actionRef values supplied by the host.",
      ],
    },
  ],
});

export const library = cotGenUILibrary;
export { promptOptions } from "./promptOptions";
