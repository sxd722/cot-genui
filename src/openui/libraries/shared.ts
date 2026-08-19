"use client";

import { createLibrary } from "@openuidev/react-lang";
import { cotGenUILibrary } from "../library";

export function buildPromptLibrary(id: string, componentNames: readonly string[]) {
  const components = componentNames.map((name) => {
    const component = cotGenUILibrary.components[name];
    if (!component) throw new Error(`Unknown OpenUI palette component: ${name}`);
    return component;
  });
  return createLibrary({
    id,
    root: "CardDeck",
    components,
    componentGroups: [{
      name: "Prompt Capability Palette",
      components: [...componentNames],
      notes: ["CardDeck is the only root.", "GeneratedCard is the only peer-card boundary.", "Raw URLs and external tool calls are forbidden."],
    }],
  });
}
