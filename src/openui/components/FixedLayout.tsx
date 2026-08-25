"use client";

/* eslint-disable @next/next/no-img-element -- host-validated remote assets cannot use a static Next Image allowlist */

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { useAssetRecord } from "../assetContext";
import { HostActionChip, HostActionItem } from "./HostActions";

const shortText = z.string().max(180);

export const FixedFacts = defineComponent({
  name: "FixedFacts",
  description: "Bounded fixed-canvas fact list. Use 1-4 concise facts; every fact remains visible.",
  props: z.object({ items: z.array(shortText).min(1).max(4) }),
  component: ({ props }) => <ul className="openui-fixed-facts">{props.items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>,
});

export const FixedList = defineComponent({
  name: "FixedList",
  description: "Bounded fixed-canvas list with at most four visible rows.",
  props: z.object({ items: z.array(z.object({ title: z.string().max(80), detail: z.string().max(140).optional() })).min(1).max(4) }),
  component: ({ props }) => <ul className="openui-fixed-list">{props.items.map((item, index) => <li key={`${item.title}-${index}`}><strong>{item.title}</strong>{item.detail ? <span>{item.detail}</span> : null}</li>)}</ul>,
});

export const FixedMetrics = defineComponent({
  name: "FixedMetrics",
  description: "One fixed-height row containing one to three metrics.",
  props: z.object({ items: z.array(z.object({ label: z.string().max(24), value: z.string().max(24), detail: z.string().max(32).optional() })).min(1).max(3) }),
  component: ({ props }) => <dl className="openui-fixed-metrics">{props.items.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd>{item.detail ? <small>{item.detail}</small> : null}</div>)}</dl>,
});

export const FixedTimeline = defineComponent({
  name: "FixedTimeline",
  description: "Bounded timeline with at most four compact milestones.",
  props: z.object({ items: z.array(z.object({ title: z.string().max(32), detail: z.string().max(56).optional(), meta: z.string().max(20).optional() })).min(1).max(4) }),
  component: ({ props }) => <ol className="openui-fixed-timeline">{props.items.map((item, index) => <li key={`${item.title}-${index}`}><b>{index + 1}</b><div>{item.meta ? <small>{item.meta}</small> : null}<strong>{item.title}</strong>{item.detail ? <span>{item.detail}</span> : null}</div></li>)}</ol>,
});

export const FixedComparison = defineComponent({
  name: "FixedComparison",
  description: "Two compact comparison columns with at most three rows each.",
  props: z.object({ columns: z.array(z.object({ title: z.string().max(28), badge: z.string().max(16).optional(), rows: z.array(z.object({ label: z.string().max(24), value: z.string().max(32) })).min(1).max(3) })).min(2).max(2) }),
  component: ({ props }) => <div className="openui-fixed-comparison">{props.columns.map((column, index) => <section key={`${column.title}-${index}`}><header>{column.badge ? <span>{column.badge}</span> : null}<strong>{column.title}</strong></header><dl>{column.rows.map((row, rowIndex) => <div key={`${row.label}-${rowIndex}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></section>)}</div>,
});

export const FixedMedia = defineComponent({
  name: "FixedMedia",
  description: "Fixed-height host-owned media hero. assetRef is an optional host-provided ID, never a URL.",
  props: z.object({ title: z.string().max(80), subtitle: z.string().max(180).optional(), assetRef: z.string().optional(), badges: z.array(z.string().max(24)).max(2).optional() }),
  component: function FixedMediaRenderer({ props }) {
    const asset = useAssetRecord(props.assetRef ?? "");
    return <section className="openui-fixed-media" data-asset-ref={props.assetRef}>
      {asset ? <><img src={asset.src} alt={asset.alt} loading="lazy" referrerPolicy="no-referrer" /><i aria-hidden="true" /></> : null}
      <div>{props.badges?.length ? <p>{props.badges.map((badge) => <span key={badge}>{badge}</span>)}</p> : null}<strong>{props.title}</strong>{props.subtitle ? <small>{props.subtitle}</small> : null}</div>
    </section>;
  },
});

function FixedGalleryImage({ assetRef }: { assetRef: string }) {
  const asset = useAssetRecord(assetRef);
  if (!asset) return <div data-asset-ref={assetRef}>图片暂不可用</div>;
  return <figure data-asset-ref={assetRef}><img src={asset.src} alt={asset.alt} loading="lazy" referrerPolicy="no-referrer" /></figure>;
}

export const FixedGallery = defineComponent({
  name: "FixedGallery",
  description: "Fixed-height two-image gallery using only host-owned assetRef IDs.",
  props: z.object({ assetRefs: z.array(z.string()).min(2).max(2) }),
  component: ({ props }) => <div className="openui-fixed-gallery">{props.assetRefs.map((assetRef) => <FixedGalleryImage key={assetRef} assetRef={assetRef} />)}</div>,
});

export const FixedActions = defineComponent({
  name: "FixedActions",
  description: "One fixed-height action row with one or two host-bound actions.",
  props: z.object({ actions: z.array(z.union([HostActionChip.ref, HostActionItem.ref])).min(1).max(2) }),
  component: ({ props, renderNode }) => <div className="openui-fixed-actions">{renderNode(props.actions)}</div>,
});

const primaryRef = z.union([FixedFacts.ref, FixedList.ref, FixedMetrics.ref, FixedTimeline.ref, FixedComparison.ref, FixedMedia.ref, FixedGallery.ref]);
const secondaryRef = z.union([FixedFacts.ref, FixedList.ref, FixedMetrics.ref]);

export const FixedCardContent = defineComponent({
  name: "FixedCardContent",
  description: "Required body grammar for a 600x300 GeneratedCard: one primary region, optional compact secondary region, and optional FixedActions row.",
  props: z.object({ content: z.array(z.union([primaryRef, secondaryRef])).min(1).max(2), actions: z.optional(FixedActions.ref) }),
  component: ({ props, renderNode }) => <div className="openui-fixed-card-content">
    {props.content.map((region, index) => <div key={index} className={index === 0 ? "openui-fixed-card-content__primary" : "openui-fixed-card-content__secondary"}>{renderNode(region)}</div>)}
    {props.actions ? <div className="openui-fixed-card-content__actions">{renderNode(props.actions)}</div> : null}
  </div>,
});

export const FIXED_LAYOUT_COMPONENTS = [FixedFacts, FixedList, FixedMetrics, FixedTimeline, FixedComparison, FixedMedia, FixedGallery, FixedActions, FixedCardContent] as const;
