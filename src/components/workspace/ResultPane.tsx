"use client";

import { OpenUIRenderer } from "@/components/OpenUIRenderer";
import { useInferStore, type ResultView } from "@/store/useInferStore";
import { CardPlanMarkdownView } from "./CardPlanMarkdownView";

export function ResultPane() {
  const { steps, cardPlan, cardPlanMarkdown, openuiCode, assetManifest, openuiDiagnostics, rightView, setRightView } = useInferStore();
  const streaming = steps.openui_generate.status === "loading";
  const canShowOpenUI = !!cardPlan && (streaming || !!openuiCode);
  const fallback: ResultView | null = canShowOpenUI ? "openui" : cardPlanMarkdown ? "cardplan-markdown" : cardPlan ? "cardplan-json" : null;
  const requested = rightView ?? fallback;
  const active = (requested === "cardplan-markdown" && !cardPlanMarkdown)
    || (requested === "cardplan-json" && !cardPlan)
    || (requested === "openui" && !canShowOpenUI)
    || (requested === "openui-source" && !openuiCode) ? fallback : requested;
  return (
    <section className="flex min-h-0 flex-col overflow-hidden border-b border-zinc-200 bg-zinc-950 dark:border-zinc-800">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-[10px] text-zinc-400">结果</span>
        <select value={active ?? ""} disabled={!active} onChange={(event) => setRightView(event.target.value as ResultView)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300">
          <option value="" disabled>等待 CardPlan</option>
          <option value="cardplan-markdown" disabled={!cardPlanMarkdown}>📝 CardPlan Markdown</option>
          <option value="cardplan-json" disabled={!cardPlan}>📦 CardPlan JSON</option>
          <option value="openui" disabled={!canShowOpenUI}>✨ OpenUI 渲染</option>
          <option value="openui-source" disabled={!openuiCode}>⌨️ OpenUI 源码</option>
        </select>
        {active === "openui-source" && openuiDiagnostics ? <span className="text-[10px] text-zinc-500">覆盖 {openuiDiagnostics.coverage.matched}/{openuiDiagnostics.coverage.required}</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {!active ? <div className="flex h-full items-center justify-center text-xs text-zinc-500">执行⑤ CardPlan 后在此查看和编辑卡片</div> : null}
        {active === "openui" && cardPlan ? <div className="workspace-openui h-full p-3"><OpenUIRenderer code={openuiCode ?? ""} cardPlan={cardPlan} assetManifest={assetManifest} assetResolutionDiagnostics={openuiDiagnostics?.assetResolutionDiagnostics} assetUsage={openuiDiagnostics?.quality?.assetUsage} isStreaming={streaming} /></div> : null}
        {active === "openui-source" && openuiCode ? <pre className="h-full overflow-auto p-3 font-mono text-[10px] leading-relaxed text-cyan-300/80">{openuiCode}</pre> : null}
        {active === "cardplan-markdown" && cardPlanMarkdown ? <CardPlanMarkdownView markdown={cardPlanMarkdown} /> : null}
        {active === "cardplan-json" && cardPlan ? <pre className="h-full overflow-auto p-3 font-mono text-[10px] leading-relaxed text-emerald-300/80">{JSON.stringify(cardPlan, null, 2)}</pre> : null}
      </div>
    </section>
  );
}

