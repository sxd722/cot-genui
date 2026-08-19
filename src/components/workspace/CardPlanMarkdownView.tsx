"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function CardPlanMarkdownView({ markdown }: { markdown: string }) {
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
        <div><p className="text-[10px] font-medium">CardPlan Markdown</p><p className="text-[9px] text-zinc-400">CardPlan 的确定性文本投影</p></div>
        <div className="flex gap-1">
          {(["preview", "source"] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded px-2 py-1 text-[10px] ${mode === value ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>{value === "preview" ? "预览" : "源文"}</button>)}
          <button type="button" onClick={copyMarkdown} className="rounded border border-zinc-300 px-2 py-1 text-[10px] dark:border-zinc-700">{copied ? "✓ 已复制" : "复制"}</button>
        </div>
      </div>
      {mode === "source" ? <pre className="flex-1 overflow-auto whitespace-pre-wrap bg-zinc-950 p-3 font-mono text-[10px] leading-relaxed text-emerald-300/90">{markdown}</pre> : (
        <div className="flex-1 overflow-y-auto p-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            h1: ({ children }) => <h1 className="mb-3 text-lg font-semibold">{children}</h1>,
            h2: ({ children }) => <h2 className="mb-2 mt-5 border-b border-zinc-200 pb-1 text-sm font-semibold first:mt-0 dark:border-zinc-800">{children}</h2>,
            h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-xs font-semibold text-zinc-700 dark:text-zinc-300">{children}</h3>,
            p: ({ children }) => <p className="my-2 text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">{children}</p>,
            ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-[11px]">{children}</ul>,
            blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-[11px] dark:bg-amber-950/30">{children}</blockquote>,
            table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-[10px]">{children}</table></div>,
            th: ({ children }) => <th className="border border-zinc-300 bg-zinc-100 px-2 py-1 text-left dark:border-zinc-700 dark:bg-zinc-900">{children}</th>,
            td: ({ children }) => <td className="border border-zinc-300 px-2 py-1 dark:border-zinc-700">{children}</td>,
          }}>{markdown}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

