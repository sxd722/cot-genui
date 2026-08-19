"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";

export const MetricRow = defineComponent({
  name: "MetricRow",
  description: "A compact row of key metrics. Prefer this over manually stacking labels and values.",
  props: z.object({ items: z.array(z.object({ label: z.string(), value: z.string(), detail: z.string().optional() })) }),
  component: ({ props }) => (
    <dl className="openui-metric-row">
      {props.items.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd>{item.detail ? <small>{item.detail}</small> : null}</div>)}
    </dl>
  ),
});
