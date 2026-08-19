"use client";

import type { PolicyObservation } from "@/learning/types";
import type { PolicyGradientCandidate } from "@/lib/reflection/types";

export function PolicyCandidateCard({ candidate, decision, onApply, onDiscard }: {
  candidate: PolicyGradientCandidate;
  decision: PolicyObservation["decision"];
  onApply: () => void;
  onDiscard: () => void;
}) {
  const target = candidate.target === "profileOverlay" ? "Profile View selection" : candidate.target;
  return <article className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
    <div className="flex items-center justify-between gap-2"><strong className="text-xs">{target} · {candidate.taskFamily}</strong><code className="text-[9px] text-indigo-500">{candidate.themeKey}</code></div>
    <div className="mt-2 grid gap-2 text-[10px] md:grid-cols-2"><div className="rounded bg-zinc-100 p-2 dark:bg-zinc-900"><span className="text-zinc-400">当前</span><p className="mt-1">{candidate.previousText || "（无覆盖，使用默认策略）"}</p></div><div className="rounded bg-indigo-50 p-2 text-indigo-950 dark:bg-indigo-950/50 dark:text-indigo-200"><span className="text-indigo-400">候选</span><p className="mt-1">{candidate.candidateText}</p></div></div>
    <div className="mt-2 flex items-center gap-2"><span className="text-[9px] text-zinc-400">置信度 {Math.round(candidate.confidence * 100)}% · 归因 {Math.round(candidate.attributionProbability * 100)}%</span><div className="ml-auto flex gap-1">{decision === "pending" ? <><button type="button" onClick={onDiscard} className="rounded border border-zinc-300 px-2 py-1 text-[10px] dark:border-zinc-700">Discard</button><button type="button" onClick={onApply} className="rounded bg-indigo-600 px-2 py-1 text-[10px] text-white">Apply</button></> : <span className="rounded bg-zinc-100 px-2 py-1 text-[10px] dark:bg-zinc-900">{decision === "discarded" ? "已丢弃" : decision === "auto-applied" ? "已自动应用" : "已应用"}</span>}</div></div>
  </article>;
}

