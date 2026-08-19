"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";

export const RecommendationGrid = defineComponent({
  name: "RecommendationGrid",
  description: "A scan-friendly grid of recommendations. assetRef is an optional host-owned asset ID, never a URL.",
  props: z.object({ items: z.array(z.object({ title: z.string(), detail: z.string().optional(), badge: z.string().optional(), assetRef: z.string().optional() })) }),
  component: ({ props }) => (
    <div className="openui-recommendation-grid">
      {props.items.map((item, index) => <article key={`${item.title}-${index}`}>{item.assetRef ? <div className="openui-semantic-media-placeholder" data-asset-ref={item.assetRef}>MEDIA</div> : null}<div>{item.badge ? <span>{item.badge}</span> : null}<strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}</div></article>)}
    </div>
  ),
});
