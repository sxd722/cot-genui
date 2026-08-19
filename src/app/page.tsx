"use client";

import { useEffect } from "react";
import { InputPanel } from "@/components/InputPanel";
import { InferencePane } from "@/components/workspace/InferencePane";
import { ResultPane } from "@/components/workspace/ResultPane";
import { EditComposer } from "@/components/workspace/EditComposer";
import { ReflectionOverlay } from "@/components/reflection/ReflectionOverlay";
import { useInferStore } from "@/store/useInferStore";

export default function Home() {
  const { isMock, steps, runAll, runAllPaused, continueGenerate, initializeLearning } = useInferStore();
  const anyDone = Object.values(steps).some((step) => step.status === "done");
  const anyLoading = Object.values(steps).some((step) => step.status === "loading");
  useEffect(() => { void initializeLearning(); }, [initializeLearning]);

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900 dark:bg-black dark:text-zinc-100">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="flex items-baseline gap-2"><h1 className="text-sm font-semibold">cot-genui</h1><span className="text-xs text-zinc-500">自适应推理 · CardPlan · OpenUI 局部编辑</span></div>
        <div className="flex items-center gap-2">
          {anyDone && isMock ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">Mock 输出</span> : null}
          <span className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-500 dark:border-zinc-700">六步管线保持冻结</span>
          <button onClick={runAllPaused ? continueGenerate : runAll} disabled={anyLoading} className={`rounded-md px-3 py-1 text-xs font-medium text-white disabled:opacity-40 ${runAllPaused ? "bg-emerald-600" : "bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900"}`}>{anyLoading ? "推理中…" : runAllPaused ? "▶ 继续生成" : "一键全部"}</button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
        <InputPanel />
        <main className="grid min-h-0 grid-rows-[minmax(220px,38%)_minmax(280px,1fr)_minmax(150px,auto)] overflow-hidden">
          <InferencePane />
          <ResultPane />
          <EditComposer />
        </main>
      </div>
      <ReflectionOverlay />
    </div>
  );
}
