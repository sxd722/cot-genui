"use client";

import type { InferSlot } from "@/lib/schemas";
import { toText, toTextInline } from "@/lib/format";

const STATUS_META: Record<
  InferSlot["status"],
  { label: string; bar: string; text: string }
> = {
  high: { label: "高置信", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  medium: { label: "中置信", bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  low: { label: "低置信", bar: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  conflict: { label: "冲突", bar: "bg-purple-500", text: "text-purple-600 dark:text-purple-400" },
};

export function SlotTable({ slots }: { slots: InferSlot[] }) {
  if (slots.length === 0) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-xs">
        <thead className="bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-2 py-1.5 font-medium">槽位</th>
            <th className="px-2 py-1.5 font-medium">推断值</th>
            <th className="px-2 py-1.5 font-medium">置信度</th>
            <th className="px-2 py-1.5 font-medium">证据来源</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {slots.map((s) => {
            const meta = STATUS_META[s.status] ?? STATUS_META.low;
            const conf = typeof s.confidence === "number" ? s.confidence : 0;
            return (
              <tr key={s.name} className="align-top">
                <td className="px-2 py-1.5 font-mono text-zinc-900 dark:text-zinc-100">{toTextInline(s.name)}</td>
                <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300">
                  {toTextInline(s.value) || <span className="italic text-zinc-400">（待确认）</span>}
                  {toText(s.evidence) && (
                    <span className="mt-0.5 block whitespace-pre-wrap text-[11px] text-zinc-500">{toText(s.evidence)}</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-10 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className={`h-full ${meta.bar}`}
                        style={{ width: `${Math.round(conf * 100)}%` }}
                      />
                    </div>
                    <span className={`text-[11px] font-medium ${meta.text}`}>
                      {Math.round(conf * 100)}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1.5 font-mono text-[10px] text-zinc-500">
                  {toTextInline(s.source_record, "—")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
