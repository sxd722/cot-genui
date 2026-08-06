"use client";

import { useState } from "react";
import { InputPanel } from "@/components/InputPanel";
import { CotTrace } from "@/components/CotTrace";
import { ResultPanel } from "@/components/ResultPanel";
import { StackedCards } from "@/components/StackedCards";
import { DslCardHost } from "@/components/dsl/DslCardHost";
import { validateArtifact } from "@/dsl/validate";
import { useInferStore } from "@/store/useInferStore";

export default function Home() {
  const {
    isMock, result, steps, runAll,
    compiledArtifact, compileNotices,
    enrichStatus, enrichProgress, enrichResults,
  } = useInferStore();
  const [rightView, setRightView] = useState<"cards" | "dsl">("dsl");

  const anyDone = Object.values(steps).some((s) => s.status === "done");
  const anyLoading = Object.values(steps).some((s) => s.status === "loading");
  // generate 步完成且产出了卡片 → 右栏切换为卡片视图
  const showCards =
    steps.generate.status === "done" &&
    !!result &&
    Array.isArray(result.cards) &&
    result.cards.length > 0;
  // generate 步完成且编译出了 artifact → 可显示 DSL 卡片
  const hasDsl = !!compiledArtifact;
  const dslValidation = compiledArtifact ? validateArtifact(compiledArtifact) : null;

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
        {/* 右栏：generate 完成后显示切换器 */}
        {hasDsl || showCards ? (
          <aside className="flex w-[360px] shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
            {/* 视图切换 */}
            <div className="flex shrink-0 gap-1 border-b border-zinc-200 p-1.5 dark:border-zinc-800">
              <button
                onClick={() => setRightView("dsl")}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                  rightView === "dsl"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
                }`}
              >
                📋 DSL 卡片
              </button>
              <button
                onClick={() => setRightView("cards")}
                disabled={!showCards}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all disabled:opacity-30 ${
                  rightView === "cards"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
                }`}
              >
                🎴 堆叠卡片
              </button>
            </div>
            {/* 内容区 */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {rightView === "dsl" && (hasDsl || enrichStatus === "enriching" || enrichStatus === "scanning") ? (
                <div className="flex h-full flex-col bg-zinc-950 p-3">
                  {/* 信息补齐进度 */}
                  {(enrichStatus === "scanning" || enrichStatus === "enriching") && (
                    <div className="mb-2 shrink-0 rounded bg-blue-950/50 px-2 py-1.5 text-[10px] text-blue-400">
                      <span className="animate-pulse">🔍 信息补齐中</span>
                      {enrichProgress.total > 0 && (
                        <span className="ml-1">
                          · {enrichProgress.done}/{enrichProgress.total} · {enrichProgress.current}
                        </span>
                      )}
                    </div>
                  )}
                  {/* 补齐结果摘要 */}
                  {enrichStatus === "done" && enrichResults.length > 0 && (
                    <div className="mb-2 shrink-0 rounded bg-emerald-950/50 px-2 py-1.5 text-[10px] text-emerald-400">
                      ✓ 信息补齐完成 · {enrichResults.filter(r => r.success).length}/{enrichResults.length} 项成功
                    </div>
                  )}
                  {enrichStatus === "skipped" && (
                    <div className="mb-2 shrink-0 rounded bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-500">
                      无需信息补齐 · 直接编译
                    </div>
                  )}
                  {/* 校验状态 + 编译诊断 */}
                  {(dslValidation || compileNotices.length > 0) && (
                    <div className="mb-2 shrink-0 space-y-1">
                      {dslValidation && (
                        <div className={`rounded px-2 py-1 text-[10px] ${dslValidation.valid ? "bg-emerald-950/50 text-emerald-400" : "bg-rose-950/50 text-rose-400"}`}>
                          {dslValidation.valid ? "✓ 校验通过" : `✗ ${dslValidation.errors.length} 处错误`}
                        </div>
                      )}
                      {compileNotices.length > 0 && (
                        <div className="rounded bg-amber-950/50 px-2 py-1 text-[10px] text-amber-400">
                          编译降级 · {compileNotices.length} 处
                        </div>
                      )}
                    </div>
                  )}
                  {/* 卡片渲染 or 补齐中占位 */}
                  {hasDsl ? (
                    <div className="flex-1 overflow-hidden">
                      <DslCardHost artifact={compiledArtifact} />
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-400" />
                    </div>
                  )}
                </div>
              ) : rightView === "cards" && showCards ? (
                <StackedCards />
              ) : (
                <ResultPanel />
              )}
            </div>
          </aside>
        ) : (
          <ResultPanel />
        )}
      </div>
    </div>
  );
}
