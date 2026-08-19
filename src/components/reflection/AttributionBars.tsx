"use client";

import { ATTRIBUTION_TARGETS, type AttributionReport } from "@/lib/reflection/types";

const LABEL = { profile: "Profile", step1: "Step 1", step2: "Step 2", step3: "Step 3", step4: "Step 4", step5: "Step 5", step6: "Step 6" } as const;

export function AttributionBars({ report }: { report: AttributionReport }) {
  return (
    <div className="space-y-2">
      {ATTRIBUTION_TARGETS.map((target) => {
        const value = report.distribution[target];
        return <div key={target} className="grid grid-cols-[54px_1fr_42px] items-center gap-2 text-[11px]"><span>{LABEL[target]}</span><div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.round(value * 100)}%` }} /></div><span className="text-right tabular-nums text-zinc-500">{Math.round(value * 100)}%</span></div>;
      })}
    </div>
  );
}

