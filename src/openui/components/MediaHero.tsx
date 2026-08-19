"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";

export const MediaHero = defineComponent({
  name: "MediaHero",
  description: "A prominent editorial hero with an optional host-owned assetRef. Never pass a URL.",
  props: z.object({ title: z.string(), subtitle: z.string().optional(), assetRef: z.string().optional(), badges: z.array(z.string()).optional() }),
  component: ({ props }) => (
    <section className={`openui-media-hero ${props.assetRef ? "openui-media-hero--pending" : ""}`} data-asset-ref={props.assetRef}>
      <div>{props.badges?.length ? <p>{props.badges.map((badge) => <span key={badge}>{badge}</span>)}</p> : null}<strong>{props.title}</strong>{props.subtitle ? <small>{props.subtitle}</small> : null}</div>
    </section>
  ),
});
