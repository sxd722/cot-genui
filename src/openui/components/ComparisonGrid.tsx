"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";

export const ComparisonGrid = defineComponent({
  name: "ComparisonGrid",
  description: "Side-by-side option columns with consistently labeled comparison rows.",
  props: z.object({ columns: z.array(z.object({ title: z.string(), rows: z.array(z.object({ label: z.string(), value: z.string() })), badge: z.string().optional() })) }),
  component: ({ props }) => (
    <div className="openui-comparison-grid">
      {props.columns.map((column, index) => <section key={`${column.title}-${index}`}><header>{column.badge ? <span>{column.badge}</span> : null}<strong>{column.title}</strong></header><dl>{column.rows.map((row, rowIndex) => <div key={`${row.label}-${rowIndex}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></section>)}
    </div>
  ),
});
