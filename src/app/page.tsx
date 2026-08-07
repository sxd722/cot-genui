"use client";

import { useState, type ReactNode } from "react";
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
    genMode, setGenMode,
    cardPlan, semanticCards,
    runAllPaused, continueGenerate,
  } = useInferStore();
  const [rightView, setRightView] = useState<"dsl" | "cards" | "raw" | "semantic" | "blueprint">("dsl");

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
          {/* 生成模式切换 */}
          <select
            value={genMode}
            onChange={(e) => setGenMode(e.target.value as "ir" | "semantic")}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-600 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
            title="第7步生成模式"
          >
            <option value="ir">🔧 结构化 IR → DSL</option>
            <option value="semantic">📝 纯语义描述</option>
          </select>
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
        {hasDsl || showCards || !!semanticCards ? (
          <aside className="flex w-[360px] shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
            {/* 视图切换下拉框 */}
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 p-2 dark:border-zinc-800">
              <span className="text-[10px] text-zinc-400">视图</span>
              <select
                value={rightView}
                onChange={(e) => setRightView(e.target.value as "dsl" | "cards" | "raw" | "semantic" | "blueprint")}
                className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <option value="dsl">📋 DSL 卡片渲染</option>
                <option value="cards" disabled={!showCards}>🎴 堆叠卡片</option>
                <option value="semantic" disabled={!semanticCards}>📝 语义卡片描述</option>
                <option value="blueprint" disabled={!semanticCards && !cardPlan}>📦 Blueprint JSON</option>
                <option value="raw" disabled={!cardPlan}>🔧 GLM Raw IR</option>
              </select>
            </div>
            {/* 内容区 */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* 语义卡片描述 */}
              {rightView === "semantic" && semanticCards ? (
                <SemanticCardsView cards={semanticCards} />
              ) : /* Blueprint JSON */
              rightView === "blueprint" && (semanticCards || cardPlan) ? (
                <div className="flex h-full flex-col overflow-hidden bg-zinc-950 p-3">
                  <div className="mb-2 shrink-0 text-[10px] text-zinc-500">
                    Blueprint JSON · {semanticCards ? "semantic 模式" : "IR 模式"} · 可直接复制给后续 LLM
                  </div>
                  <pre className="flex-1 overflow-auto rounded-lg bg-zinc-900 p-2 font-mono text-[10px] leading-relaxed text-emerald-300/80">
                    {JSON.stringify(semanticCards ?? cardPlan, null, 2)}
                  </pre>
                </div>
              ) : /* GLM Raw 输出 */
              rightView === "raw" && cardPlan ? (
                <div className="flex h-full flex-col overflow-hidden bg-zinc-950 p-3">
                  <div className="mb-2 shrink-0 text-[10px] text-zinc-500">
                    GLM 第7步产出的 CardPlan IR（enrich 前的原始 JSON）
                  </div>
                  <pre className="flex-1 overflow-auto rounded-lg bg-zinc-900 p-2 font-mono text-[10px] leading-relaxed text-emerald-300/80">
                    {JSON.stringify(cardPlan, null, 2)}
                  </pre>
                </div>
              ) : rightView === "dsl" && (hasDsl || enrichStatus === "enriching" || enrichStatus === "scanning") ? (
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

/* ----------------------- 语义卡片描述视图 ----------------------- */

function SemanticCardsView({ cards }: { cards: unknown }) {
  const list = Array.isArray(cards) ? cards : [];
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-50 p-3 dark:bg-zinc-950">
      <div className="mb-2 shrink-0 text-[10px] text-zinc-500">
        GLM 语义 Blueprint · {list.length} 张卡片 · content(markdown) + data(数据源) + action(操作)
      </div>
      <div className="flex flex-col gap-2.5">
        {list.map((card, i) => {
          const c = card as Record<string, unknown>;
          const name = String(c.name ?? `card${i + 1}`);
          const content = String(c.content ?? "");
          const data = Array.isArray(c.data) ? c.data.map(String) : [];
          const actions = Array.isArray(c.action) ? c.action.map(String) : [];
          return (
            <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              {/* 卡片标识 */}
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {i + 1}
                </span>
                <code className="text-xs font-mono font-medium text-[var(--dsl-accent,#D7AE59)]">{name}</code>
              </div>

              {/* content（markdown 正文，高亮 @引用 和 action链接） */}
              {!!content && (
                <div className="mt-2">
                  <SemanticMarkdown text={content} />
                </div>
              )}

              {/* data 数据源索引 */}
              {data.length > 0 && (
                <div className="mt-2 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
                  <p className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">data</p>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {data.map((d, j) => (
                      <li key={j} className="font-mono text-[9px] leading-relaxed text-cyan-600 dark:text-cyan-400">
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* action 操作索引 */}
              {actions.length > 0 && (
                <div className="mt-1.5">
                  <p className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">action</p>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {actions.map((a, j) => (
                      <li key={j} className="font-mono text-[9px] leading-relaxed text-purple-600 dark:text-purple-400">
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 渲染混写 markdown content：
 * - @slot 引用 → 蓝色高亮
 * - [文字](action:...) → 绿色可点击样式
 * - 其余按纯文本 + 换行渲染
 */
function SemanticMarkdown({ text }: { text: string }) {
  // 按行渲染，每行内做 @引用 和 action链接 的着色
  const lines = text.split("\n");
  return (
    <div className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
      {lines.map((line, i) => (
        <span key={i}>
          {renderInlineMarkdown(line)}
          {"\n"}
        </span>
      ))}
    </div>
  );
}

/** 单行内的 @引用 和 [text](action:...) 着色 */
function renderInlineMarkdown(line: string): ReactNode[] {
  const parts: React.ReactNode[] = [];
  // 匹配 [text](action:...) 或 @slot_name 或 @slot_name(默认值)
  const regex = /(\[([^\]]+)\]\(action:[^)]+\))|(@[a-zA-Z_][a-zA-Z0-9_]*(\([^)]*\))?)/g;
  let last = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    if (match[2] !== undefined) {
      // [text](action:...) 链接
      const linkMatch = match[1].match(/\[([^\]]+)\]\((action:[^)]+)\)/);
      parts.push(
        <span key={`a${key++}`} className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" title={linkMatch?.[2]}>
          {linkMatch?.[1]} ↗
        </span>,
      );
    } else if (match[3] !== undefined) {
      // @slot 引用
      parts.push(
        <span key={`s${key++}`} className="rounded bg-blue-100 px-0.5 font-mono text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-400">
          {match[3]}
        </span>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}
