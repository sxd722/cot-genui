"use client";

import { InputPanel } from "@/components/InputPanel";
import { CotTrace } from "@/components/CotTrace";
import { ResultPanel } from "@/components/ResultPanel";
import { StackedCards } from "@/components/StackedCards";
import { useInferStore } from "@/store/useInferStore";

export default function Home() {
  const { isMock, result, steps, runAll } = useInferStore();

  const anyDone = Object.values(steps).some((s) => s.status === "done");
  const anyLoading = Object.values(steps).some((s) => s.status === "loading");
  // generate 步完成且产出了卡片 → 右栏切换为堆叠卡片视图
  const showCards =
    steps.generate.status === "done" &&
    !!result &&
    Array.isArray(result.cards) &&
    result.cards.length > 0;

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900 dark:bg-black dark:text-zinc-100">
      {/* 顶栏 */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold">cot-genui</h1>
          <span className="text-xs text-zinc-500">意图消歧 CoT 可视化调试工具 · 分步推理</span>
        </div>
        <div className="flex items-center gap-2">
          {anyDone && isMock && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              Mock 输出（未配置 LLM_API_KEY）
            </span>
          )}
          <button
            onClick={runAll}
            disabled={anyLoading}
            className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {anyLoading ? "推理中…" : "一键全部"}
          </button>
        </div>
      </header>

      {/* 三栏主体 */}
      <div className="flex flex-1 overflow-hidden">
        <InputPanel />
        <main className="flex flex-1 flex-col overflow-hidden">
          <CotTrace />
        </main>
        {showCards ? <StackedCards /> : <ResultPanel />}
      </div>
    </div>
  );
}
