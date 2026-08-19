"use client";

import { defineComponent, useIsStreaming, useTriggerAction } from "@openuidev/react-lang";
import { z } from "zod/v4";

function useHostAction(actionRef: string) {
  const triggerAction = useTriggerAction();
  return () => void triggerAction(actionRef);
}

export const HostActionChip = defineComponent({
  name: "HostActionChip",
  description: "Compact host-side action affordance. actionRef must be copied exactly from CardPlan Markdown.",
  props: z.object({ label: z.string(), actionRef: z.string() }),
  component: function HostActionChipRenderer({ props }) {
    const isStreaming = useIsStreaming();
    const run = useHostAction(props.actionRef);
    return <button type="button" className="openui-action-chip" disabled={isStreaming} onClick={run}>{props.label}</button>;
  },
});

export const HostActionItem = defineComponent({
  name: "HostActionItem",
  description: "A host-side action rendered as a descriptive list or menu row.",
  props: z.object({ label: z.string(), actionRef: z.string(), description: z.string().optional() }),
  component: function HostActionItemRenderer({ props }) {
    const isStreaming = useIsStreaming();
    const run = useHostAction(props.actionRef);
    return (
      <button type="button" className="openui-action-item" disabled={isStreaming} onClick={run}>
        <span><strong>{props.label}</strong>{props.description ? <small>{props.description}</small> : null}</span>
        <span aria-hidden="true">↗</span>
      </button>
    );
  },
});

export const HostActionMenu = defineComponent({
  name: "HostActionMenu",
  description: "Groups HostActionItem rows as a compact more-actions menu surface.",
  props: z.object({ items: z.array(HostActionItem.ref), title: z.string().optional() }),
  component: ({ props, renderNode }) => (
    <div className="openui-action-group openui-action-group--menu">
      {props.title ? <p>{props.title}</p> : null}
      {renderNode(props.items)}
    </div>
  ),
});

export const HostActionList = defineComponent({
  name: "HostActionList",
  description: "Groups HostActionItem rows as a visible action list.",
  props: z.object({ items: z.array(HostActionItem.ref) }),
  component: ({ props, renderNode }) => <div className="openui-action-group">{renderNode(props.items)}</div>,
});

export const MediaActionTile = defineComponent({
  name: "MediaActionTile",
  description: "A visually prominent host-side action tile. It is decorative until the later asset registry adds controlled images.",
  props: z.object({ title: z.string(), actionRef: z.string(), kicker: z.string().optional() }),
  component: function MediaActionTileRenderer({ props }) {
    const isStreaming = useIsStreaming();
    const run = useHostAction(props.actionRef);
    return (
      <button type="button" className="openui-media-action" disabled={isStreaming} onClick={run}>
        <span>{props.kicker ?? "NEXT"}</span>
        <strong>{props.title}</strong>
        <i aria-hidden="true">→</i>
      </button>
    );
  },
});
