"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { useAssetRecord } from "../assetContext";

function RecommendationMedia({ assetRef, alt }: { assetRef: string; alt: string }) {
  const asset = useAssetRecord(assetRef);
  if (!asset) return <div className="openui-semantic-media-placeholder" data-asset-ref={assetRef}>图片暂不可用</div>;
  return <div className="openui-recommendation-grid__media" data-asset-ref={assetRef}>
    {/* Host validation and registry ownership make this URL safe to render. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={asset.src} alt={asset.alt || alt} loading="lazy" referrerPolicy="no-referrer" />
  </div>;
}

export const RecommendationGrid = defineComponent({
  name: "RecommendationGrid",
  description: "A scan-friendly grid of recommendations. assetRef is an optional host-owned asset ID, never a URL.",
  props: z.object({ items: z.array(z.object({ title: z.string(), detail: z.string().optional(), badge: z.string().optional(), assetRef: z.string().optional() })) }),
  component: ({ props }) => (
    <div className="openui-recommendation-grid">
      {props.items.map((item, index) => <article key={`${item.title}-${index}`}>{item.assetRef ? <RecommendationMedia assetRef={item.assetRef} alt={item.title} /> : null}<div>{item.badge ? <span>{item.badge}</span> : null}<strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}</div></article>)}
    </div>
  ),
});
