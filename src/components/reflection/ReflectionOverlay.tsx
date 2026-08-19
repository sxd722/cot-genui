"use client";

import { useInferStore } from "@/store/useInferStore";
import { AttributionBars } from "./AttributionBars";
import { PolicyCandidateCard } from "./PolicyCandidateCard";
import { PolicyInspector } from "./PolicyInspector";

export function ReflectionOverlay() {
  const state = useInferStore();
  if (!state.isReflectionOpen) return null;
  const report = state.attributionReport;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" role="dialog" aria-modal="true" aria-label="反思学习">
    <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800"><div><h2 className="text-sm font-semibold">正在学习本次结果</h2><p className="text-[10px] text-zinc-500">最终版本已先保存；反思不会改变本次结果。</p></div><button type="button" onClick={state.closeReflection} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">关闭</button></header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="grid gap-1 text-[11px]"><p className="text-emerald-600">✓ 已保存最终版本</p><p className={report ? "text-emerald-600" : "text-zinc-400"}>{report ? "✓" : "◌"} 已比较初始结果和用户修改</p><p className={report ? "text-emerald-600" : "text-zinc-400"}>{report ? "✓" : "◌"} 已进行推理阶段归因</p><p className={state.reflectionStatus === "ready" ? "text-emerald-600" : "text-zinc-400"}>{state.reflectionStatus === "ready" ? "✓" : "◌"} {state.reflectionStatus === "generating-candidates" ? "正在生成可学习的 steering 候选" : "策略候选处理"}</p></div>
        {state.reflectionStatus === "error" ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><p>结果已保存，但本次反思失败：{state.reflectionError}</p><button type="button" onClick={() => void state.runReflection()} className="mt-2 rounded border border-rose-300 px-2 py-1">重试反思</button></div> : null}
        {state.reflectionStatus === "ready" && state.reflectionError ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">{state.reflectionError}</p> : null}
        {report ? <section className="grid gap-4 md:grid-cols-[280px_1fr]"><div><h3 className="mb-2 text-xs font-semibold">阶段归因</h3><AttributionBars report={report} /></div><div className="space-y-2">{report.reasonCodes.includes("targeted_ui_edit") ? <p className="rounded bg-cyan-50 p-2 text-[11px] text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200">这次修改被判定为局部 UI/交互调整，主要影响 OpenUI 设计阶段；未调用深度归因模型。</p> : null}{report.reasonCodes.includes("accepted_without_edits") ? <p className="rounded bg-emerald-50 p-2 text-[11px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">本次结果未修改即接受，不产生负向策略更新。</p> : null}{report.topTargets.map((target) => <div key={target.target}><strong className="text-[11px]">{target.target} · {Math.round(target.probability * 100)}%</strong><ul className="list-disc pl-4 text-[10px] text-zinc-500">{target.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div></section> : null}
        {state.reflectionStatus === "ready" && report && !state.gradientCandidates.length && !report.reasonCodes.includes("accepted_without_edits") ? <p className="rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-900">阶段归因已完成，但没有生成可安全复用的策略候选。</p> : null}
        {state.gradientCandidates.length ? <section><h3 className="mb-2 text-xs font-semibold">学习候选</h3><div className="grid gap-2">{state.gradientCandidates.map((candidate) => <PolicyCandidateCard key={candidate.id} candidate={candidate} decision={state.candidateDecisions[candidate.id] ?? "pending"} onApply={() => void state.applyPolicyCandidate(candidate.id)} onDiscard={() => void state.discardPolicyCandidate(candidate.id)} />)}</div></section> : null}
        <PolicyInspector />
      </div>
    </div>
  </div>;
}
