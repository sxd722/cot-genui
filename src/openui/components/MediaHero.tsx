"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { useAssetRecord } from "../assetContext";

export const MediaHero = defineComponent({
  name: "MediaHero",
  description: "A prominent editorial hero with an optional host-owned assetRef. Never pass a URL.",
  props: z.object({ title: z.string(), subtitle: z.string().optional(), assetRef: z.string().optional(), badges: z.array(z.string()).optional() }),
  component: function MediaHeroRenderer({ props }) {
    const asset = useAssetRecord(props.assetRef ?? "");
    return (
      <section className={`openui-media-hero ${asset ? "openui-media-hero--resolved" : props.assetRef ? "openui-media-hero--missing" : ""}`} data-asset-ref={props.assetRef}>
        {asset ? <>
          {/* Host validation and registry ownership make this URL safe to render. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="openui-media-hero__image" src={asset.src} alt={asset.alt} loading="lazy" referrerPolicy="no-referrer" />
          <div className="openui-media-hero__overlay" aria-hidden="true" />
        </> : props.assetRef ? <div className="openui-media-hero__placeholder">图片暂不可用</div> : null}
        <div className="openui-media-hero__content">{props.badges?.length ? <p>{props.badges.map((badge) => <span key={badge}>{badge}</span>)}</p> : null}<strong>{props.title}</strong>{props.subtitle ? <small>{props.subtitle}</small> : null}</div>
      </section>
    );
  },
});
