"use client";

import { Children } from "react";
import { defineComponent, useIsStreaming } from "@openuidev/react-lang";
import { z } from "zod/v4";

export const GeneratedCard = defineComponent({
  name: "GeneratedCard",
  description: "One peer card in a CardDeck. The host supplies cardId and title; compose its children freely without adding another card boundary.",
  props: z.object({
    cardId: z.string().describe("Stable CardPlan card ID"),
    title: z.string().describe("Host-provided card title"),
    children: z.array(z.any()).describe("Freely composed card content"),
    subtitle: z.string().optional(),
  }),
  component: function GeneratedCardRenderer({ props, renderNode }) {
    const isStreaming = useIsStreaming();
    const renderedChildren = renderNode(props.children);
    const isEmpty = Children.toArray(renderedChildren).length === 0;

    return (
      <article className="openui-generated-card" data-card-id={props.cardId}>
        <header className="openui-generated-card__header">
          <span className="openui-generated-card__eyebrow">{props.cardId}</span>
          <h2>{props.title}</h2>
          {props.subtitle ? <p>{props.subtitle}</p> : null}
        </header>
        <div className="openui-generated-card__body">
          {isStreaming && isEmpty ? (
            <div className="openui-generated-card__skeleton" aria-label="卡片内容生成中">
              <span />
              <span />
              <span />
              <span />
            </div>
          ) : renderedChildren}
        </div>
      </article>
    );
  },
});
