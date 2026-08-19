"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InputPanel } from "@/components/InputPanel";
import { CotTrace } from "@/components/CotTrace";
import { ResultPanel } from "@/components/ResultPanel";
import { OpenUIRenderer } from "@/components/OpenUIRenderer";
import { useInferStore, type ResultView } from "@/store/useInferStore";

export default function Home() {
  const {
    isMock, steps, runAll,
    cardPlan, cardPlanMarkdown,
    openuiCode, openuiDiagnostics,
    rightView, setRightView,
    runAllPaused, continueGenerate,
  } = useInferStore();

  const anyDone = Object.values(steps).some((s) => s.status === "done");
  const anyLoading = Object.values(steps).some((s) => s.status === "loading");
  const isOpenUIStreaming = steps.openui_generate.status === "loading";
  const canShowOpenUI = !!cardPlan && (isOpenUIStreaming || !!openuiCode);
  const fallbackRightView: ResultView | null = canShowOpenUI
    ? "openui"
    : cardPlanMarkdown
      ? "cardplan-markdown"
      : cardPlan
        ? "cardplan-json"
        : null;
  const requestedRightView = rightView ?? fallbackRightView;
  const activeRightView =
    (requestedRightView === "cardplan-markdown" && !cardPlanMarkdown) ||
    (requestedRightView === "cardplan-json" && !cardPlan) ||
    (requestedRightView === "openui" && !canShowOpenUI) ||
    (requestedRightView === "openui-source" && !openuiCode)
      ? fallbackRightView
      : requestedRightView;

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
              Mock 输出（所选模型缺少 API key）
            </span>
          )}
          <span className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-500 dark:border-zinc-700">
            CardPlan 单一协议 · 6 阶段
          </span>
          <button
            onClick={runAllPaused ? continueGenerate : runAll}
            disabled={anyLoading}
            className={`rounded-md px-3 py-1 text-xs font-medium text-white disabled:opacity-40 ${
              runAllPaused
                ? "bg-emerald-600 hover:bg-emerald-500"
                : "bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            }`}
          >
            {anyLoading ? "推理中…" : runAllPaused ? "▶ 继续生成" : "一键全部"}
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
        {activeRightView ? (
          <aside className="flex w-[360px] shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
            {/* 视图切换下拉框 */}
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 p-2 dark:border-zinc-800">
              <span className="text-[10px] text-zinc-400">视图</span>
              <select
                value={activeRightView}
                onChange={(e) => setRightView(e.target.value as ResultView)}
                className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <option value="cardplan-markdown" disabled={!cardPlanMarkdown}>📝 CardPlan Markdown</option>
                <option value="cardplan-json" disabled={!cardPlan}>📦 CardPlan JSON</option>
                <option value="openui" disabled={!canShowOpenUI}>✨ OpenUI 渲染</option>
                <option value="openui-source" disabled={!openuiCode}>⌨️ OpenUI Lang 源码</option>
              </select>
            </div>
            {/* 内容区 */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* OpenUI Lang 源码与校验结果 */}
              {activeRightView === "openui-source" && openuiCode ? (
                <div className="flex h-full flex-col overflow-hidden bg-zinc-950 p-3">
                  <div className="mb-2 shrink-0 text-[10px] text-zinc-500">
                    OpenUI Lang · 模型原始文本经 parser 与 CardPlan 覆盖校验
                    {openuiDiagnostics ? ` · ${openuiDiagnostics.coverage.matched}/${openuiDiagnostics.coverage.required} 覆盖` : ""}
                  </div>
                  <pre className="flex-1 overflow-auto rounded-lg bg-zinc-900 p-2 font-mono text-[10px] leading-relaxed text-cyan-300/80">
                    {openuiCode}
                  </pre>
                </div>
              ) : activeRightView === "openui" && canShowOpenUI && cardPlan ? (
                <div className="flex h-full flex-col bg-zinc-950 p-3">
                  <div className="mb-2 shrink-0 text-[10px] text-zinc-500">
                    OpenUI 渐进渲染 · CardPlan action 由宿主安全执行
                  </div>
                  <div className="flex-1 overflow-hidden" style={{ minHeight: "500px" }}>
                    <OpenUIRenderer
                      code={openuiCode ?? ""}
                      cardPlan={cardPlan}
                      isStreaming={isOpenUIStreaming}
                    />
                  </div>
                </div>
              ) : activeRightView === "cardplan-markdown" && cardPlanMarkdown ? (
                <CardPlanMarkdownView markdown={cardPlanMarkdown} />
              ) : activeRightView === "cardplan-json" && cardPlan ? (
                <div className="flex h-full flex-col overflow-hidden bg-zinc-950 p-3">
                  <div className="mb-2 shrink-0 text-[10px] text-zinc-500">
                    CardPlan JSON · 内部业务 IR · 动作安全、CardDeck shell 与校验的事实源
                  </div>
                  <pre className="flex-1 overflow-auto rounded-lg bg-zinc-900 p-2 font-mono text-[10px] leading-relaxed text-emerald-300/80">
                    {JSON.stringify(cardPlan, null, 2)}
                  </pre>
                </div>
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

/* ----------------------- CardPlan Markdown 视图 ----------------------- */

function CardPlanMarkdownView({ markdown }: { markdown: string }) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [copied, setCopied] = useState(false);

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div>
          <p className="text-[10px] font-medium text-zinc-600 dark:text-zinc-300">CardPlan Markdown</p>
          <p className="text-[9px] text-zinc-400">由 CardPlan 确定性派生 · 不做 YAML/JSON 解析</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={`rounded px-2 py-1 text-[10px] ${mode === "preview" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}
          >
            预览
          </button>
          <button
            type="button"
            onClick={() => setMode("source")}
            className={`rounded px-2 py-1 text-[10px] ${mode === "source" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}
          >
            源文
          </button>
          <button
            type="button"
            onClick={copyMarkdown}
            className="rounded border border-zinc-300 px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {copied ? "✓ 已复制" : "复制"}
          </button>
        </div>
      </div>

      {mode === "source" ? (
        <pre className="flex-1 overflow-auto whitespace-pre-wrap bg-zinc-950 p-3 font-mono text-[10px] leading-relaxed text-emerald-300/90">
          {markdown}
        </pre>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{children}</h1>,
              h2: ({ children }) => <h2 className="mb-2 mt-5 border-b border-zinc-200 pb-1 text-sm font-semibold text-zinc-900 first:mt-0 dark:border-zinc-800 dark:text-zinc-100">{children}</h2>,
              h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-xs font-semibold text-zinc-700 dark:text-zinc-300">{children}</h3>,
              p: ({ children }) => <p className="my-2 text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">{children}</p>,
              ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-[11px] text-zinc-700 dark:text-zinc-300">{children}</ul>,
              ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-[11px] text-zinc-700 dark:text-zinc-300">{children}</ol>,
              blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{children}</blockquote>,
              table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-[10px]">{children}</table></div>,
              th: ({ children }) => <th className="border border-zinc-300 bg-zinc-100 px-2 py-1 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-900">{children}</th>,
              td: ({ children }) => <td className="border border-zinc-300 px-2 py-1 align-top dark:border-zinc-700">{children}</td>,
              hr: () => <hr className="my-4 border-zinc-200 dark:border-zinc-800" />,
              a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline underline-offset-2 dark:text-blue-400">{children}</a>,
              pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-zinc-950 p-2 font-mono text-[10px] leading-relaxed text-indigo-300">{children}</pre>,
              code: ({ children, className }) => <code className={className ?? "rounded bg-zinc-200 px-1 py-0.5 font-mono text-[10px] dark:bg-zinc-800"}>{children}</code>,
            }}
          >
            {markdown}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
