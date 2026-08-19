"use client";

import { createElement } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { GeneratedCard } from "./GeneratedCard";

export const CardDeck = defineComponent({
  name: "CardDeck",
  description: "The only OpenUI root. Lays out GeneratedCard peers as a horizontal snap deck in narrow containers and a responsive grid in wide containers.",
  props: z.object({
    children: z.array(GeneratedCard.ref),
    layout: z.enum(["auto", "deck", "grid", "featured"]).optional(),
  }),
  component: ({ props, renderNode }) => createElement(
    "section",
    { className: `openui-card-deck openui-card-deck--${props.layout ?? "auto"}`, "aria-label": "生成式卡片集合" },
    renderNode(props.children),
  ),
});
