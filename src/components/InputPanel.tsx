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
    customContextText,
    setCustomContextText,
    profileStatus,
    profileDigest,
    profileError,
    ensureProfileDigest,
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

      <div className="rounded-md border border-zinc-200 bg-white/70 p-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-900/70">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">通用画像索引</span>
          <button
            onClick={() => void ensureProfileDigest()}
            disabled={profileStatus === "compressing"}
            className="rounded border border-zinc-300 px-2 py-0.5 text-[10px] text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400"
          >
            {profileStatus === "compressing" ? "压缩中…" : profileStatus === "ready" ? "已缓存" : profileStatus === "degraded" ? "降级目录" : "生成画像"}
          </button>
        </div>
        {profileError && <p className="mt-1 text-rose-500">{profileError}</p>}
        {profileDigest && (
          <details className="mt-1">
            <summary className="cursor-pointer text-zinc-500">{profileDigest.domains.length} 个领域 · {profileDigest.salientSignals.length} 条显著信号</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-1.5 text-[9px] dark:bg-zinc-950">{JSON.stringify(profileDigest, null, 2)}</pre>
          </details>
        )}
      </div>

      {/* 自定义上下文输入 */}
      <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-2 dark:border-indigo-900 dark:bg-indigo-950/30">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-[11px] text-indigo-700 dark:text-indigo-400">
            ✨ 自定义个人上下文（自由文本）
          </span>
          {customContextText.trim().length > 20 && (
            <button
              onClick={() => void ensureProfileDigest()}
              disabled={profileStatus === "compressing"}
              className="shrink-0 rounded border border-indigo-300 bg-indigo-600 px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50 dark:border-indigo-700"
            >
              {profileStatus === "compressing" ? "深度分析中…" : "🧠 画像索引"}
            </button>
          )}
        </div>
        <textarea
          value={customContextText}
          onChange={(e) => setCustomContextText(e.target.value)}
          placeholder={"用自然语言描述你的个人上下文，例如：\n30岁前端工程师，在上海浦东工作7年，月入2.8万，已婚有个3岁女儿，有房贷，预算敏感但消费风格偏舒适…\n\nGLM-5.2 thinking 会深度分析这段文本生成画像索引。"}
          rows={5}
          spellCheck={false}
          className="mt-1.5 w-full resize-y rounded border border-indigo-200 bg-white/80 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-800 outline-none focus:border-indigo-500 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-zinc-200"
        />
        {customContextText.trim().length > 0 && customContextText.trim().length <= 20 && (
          <p className="mt-0.5 text-[9px] text-zinc-400">至少输入 20 字符才能生成画像索引</p>
        )}
        {customContextText.trim().length > 20 && (
          <p className="mt-0.5 text-[9px] text-indigo-400">已输入 {customContextText.trim().length} 字 · 点击"画像索引"用 GLM-5.2 thinking 深度分析</p>
        )}
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
