"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { HostActionChip, HostActionItem } from "./HostActions";

export const ActionPanel = defineComponent({
  name: "ActionPanel",
  description: "A focused host-action region. Its children must be supplied HostActionChip or HostActionItem refs.",
  props: z.object({ title: z.string().optional(), description: z.string().optional(), actions: z.array(z.union([HostActionChip.ref, HostActionItem.ref])) }),
  component: ({ props, renderNode }) => (
    <section className="openui-action-panel">{props.title ? <strong>{props.title}</strong> : null}{props.description ? <p>{props.description}</p> : null}<div>{renderNode(props.actions)}</div></section>
  ),
});
