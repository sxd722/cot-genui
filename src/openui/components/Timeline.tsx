"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";

export const Timeline = defineComponent({
  name: "Timeline",
  description: "A chronological or sequential set of milestones with optional detail and metadata.",
  props: z.object({ items: z.array(z.object({ title: z.string(), detail: z.string().optional(), meta: z.string().optional() })) }),
  component: ({ props }) => (
    <ol className="openui-timeline">
      {props.items.map((item, index) => <li key={`${item.title}-${index}`}><span>{index + 1}</span><div>{item.meta ? <small>{item.meta}</small> : null}<strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}</div></li>)}
    </ol>
  ),
});
