"use client";

import { presets } from "@/lib/presets";
import { useInferStore } from "@/store/useInferStore";

export function InputPanel() {
  const {
    query,
    setQuery,
    deviceContext,
    selectPreset,
    contextText,
    setContextText,
    reset,
  } = useInferStore();

  return (
    <aside className="flex w-[360px] shrink-0 flex-col gap-3 border-r border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950 overflow-y-auto">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">输入</h2>

      {/* 用户意图 */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          用户意图 (query)
        </span>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={2}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300"
        />
      </label>

      {/* 预设场景 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          设备上下文预设
        </span>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => selectPreset(p.id)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                deviceContext.id === p.id
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
          {deviceContext.description}
        </p>
      </div>

      {/* JSON 编辑 */}
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          device_context (JSON, 可编辑)
        </span>
        <textarea
          value={contextText}
          onChange={(e) => setContextText(e.target.value)}
          spellCheck={false}
          className="min-h-[200px] flex-1 rounded-md border border-zinc-300 bg-white p-2 font-mono text-[11px] leading-relaxed text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </label>

      <button
        onClick={reset}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
      >
        重置全部
      </button>
    </aside>
  );
}
