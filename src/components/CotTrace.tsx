"use client";

import { useState } from "react";
import {
  useInferStore,
  STEP_ORDER,
  STEP_LABEL,
  type StepName,
} from "@/store/useInferStore";
import { SlotTable } from "./SlotTable";
import { toText, toTextInline } from "@/lib/format";

/** 把问题的 options（可能是字符串/对象混合数组）安全转成字符串数组 */
function optionList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => {
      if (typeof o === "string") return o;
      // 对象形式：优先取常见字段
      if (o && typeof o === "object") {
        const obj = o as Record<string, unknown>;
        return (
          toTextInline(obj.label) ||
          toTextInline(obj.value) ||
          toTextInline(obj.text) ||
          toTextInline(obj)
        );
      }
      return toTextInline(o);
    })
    .filter((s): s is string => !!s && typeof s === "string");
}

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  pending: { text: "待执行", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
  loading: { text: "执行中", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400" },
  done: { text: "完成", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" },
  error: { text: "失败", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400" },
};

function StepRow({ name }: { name: StepName }) {
  const { steps, runStep } = useInferStore();
  const s = steps[name];
  const [open, setOpen] = useState(false);
  const badge = STATUS_BADGE[s.status];
  const hasContent = s.status === "done" || s.status === "error";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 px-3 py-2">
        {/* 触发按钮 */}
        <button
          onClick={() => runStep(name)}
          disabled={s.status === "loading"}
          className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-100 dark:hover:text-zinc-100"
          title={`执行 ${STEP_LABEL[name]}`}
        >
          {s.status === "loading" ? "…" : "▶"}
        </button>

        {/* 标题（点击展开/收起） */}
        <button
          onClick={() => hasContent && setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left"
          disabled={!hasContent}
        >
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {STEP_LABEL[name]}
          </span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
            {badge.text}
          </span>
          {s.durationMs > 0 && (
            <span className="text-[10px] text-zinc-400">{(s.durationMs / 1000).toFixed(1)}s</span>
          )}
          {s.tokens && s.tokens.total > 0 && (
            <span className="text-[10px] text-zinc-400" title={`prompt ${s.tokens.prompt} + completion ${s.tokens.completion}`}>
              · {s.tokens.total} tok
            </span>
          )}
          {hasContent && (
            <span className="ml-auto text-xs text-zinc-400">{open ? "▾" : "▸"}</span>
          )}
        </button>
      </div>

      {/* 展开内容 */}
      {open && hasContent && (
        <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-900">
          {s.error ? (
            <p className="text-xs text-rose-600 dark:text-rose-400">⚠ {toText(s.error)}</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {toText(s.reasoning)}
              </p>
              {Object.keys(s.outputs).length > 0 && (
                <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-2 font-mono text-[10px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  {JSON.stringify(s.outputs, null, 2)}
                </pre>
              )}
            </>
          )}

          {/* 日志 */}
          {s.logs.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                调用日志 ({s.logs.length})
              </summary>
              <div className="mt-1 flex flex-col gap-0.5">
                {s.logs.map((l, i) => (
                  <div
                    key={i}
                    className="rounded bg-zinc-50 px-1.5 py-1 font-mono text-[10px] leading-relaxed text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                  >
                    <span className="text-zinc-400">{l.ts.slice(11, 19)}</span>{" "}
                    <span className={
                      l.phase === "error" ? "text-rose-500" :
                      l.phase === "fallback" ? "text-amber-500" :
                      l.phase === "response" ? "text-emerald-500" : "text-blue-500"
                    }>
                      [{l.phase}]
                    </span>{" "}
                    {l.message}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function CotTrace() {
  const { slots, conflicts, questions, answers, answerQuestion } = useInferStore();

  return (
    <section className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">CoT 推理过程（分步）</h2>
        <span className="text-[11px] text-zinc-400">点击 ▶ 逐步触发</span>
      </div>

      {/* 7 步，可逐个触发 */}
      <div className="flex flex-col gap-2">
        {STEP_ORDER.map((name) => (
          <StepRow key={name} name={name} />
        ))}
      </div>

      {/* 汇总：槽位表 */}
      {slots.length > 0 && (
        <div className="mt-2">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            槽位推断
          </h3>
          <SlotTable slots={slots} />
        </div>
      )}

      {/* 冲突 */}
      {conflicts.length > 0 && (
        <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50 p-3 dark:border-purple-900 dark:bg-purple-950/40">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400">
            ⚠ 检测到冲突
          </h3>
          <ul className="mt-1 flex flex-col gap-1.5">
            {conflicts.map((c, i) => {
              // 字段名不保证固定（宽松 schema）：优先用常见字段，兜底整体 JSON
              const main =
                toText(c.description) ||
                [toText(c.evidence_a), toText(c.evidence_b)].filter(Boolean).join(" vs ") ||
                toText(c, "（冲突详情）");
              const hint = toText(c.note) || toText(c.resolution_hint);
              return (
                <li key={i} className="whitespace-pre-wrap text-xs text-purple-900 dark:text-purple-300">
                  <span className="font-mono font-medium">{toText(c.slot)}</span>: {main}
                  {hint && <span className="block text-purple-600 dark:text-purple-500">{hint}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 消歧问题（可交互选择） */}
      {questions.length > 0 && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/40">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">
            需向用户澄清 · 点击选择（模拟用户回答）
          </h3>
          <ul className="mt-1.5 flex flex-col gap-2.5">
            {questions.map((q, i) => {
              const opts = optionList(q.options);
              const answered = answers[i];
              return (
                <li key={i} className="text-xs">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-medium text-rose-900 dark:text-rose-200">
                      {toText(q.question)}
                    </span>
                    {q.blocking && (
                      <span className="rounded bg-rose-200 px-1 text-[10px] text-rose-800 dark:bg-rose-900 dark:text-rose-300">
                        阻塞
                      </span>
                    )}
                    {answered && (
                      <span className="rounded bg-emerald-200 px-1 text-[10px] text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300">
                        ✓ 已回答
                      </span>
                    )}
                  </div>
                  {toText(q.reason) && (
                    <span className="mt-0.5 block text-[11px] text-rose-600 dark:text-rose-500">
                      {toText(q.reason)}
                    </span>
                  )}
                  {/* 选项按钮 */}
                  {opts.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {opts.map((opt) => {
                        const selected = answered === opt;
                        return (
                          <button
                            key={opt}
                            onClick={() => answerQuestion(i, opt)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] transition-all ${
                              selected
                                ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                                : "border-rose-300 bg-white text-rose-700 hover:border-rose-500 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300 dark:hover:bg-rose-900"
                            }`}
                          >
                            {selected ? "✓ " : ""}
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      value={answered ?? ""}
                      onChange={(e) => answerQuestion(i, e.target.value)}
                      placeholder="输入你的回答…"
                      className="mt-1.5 w-full rounded border border-rose-300 bg-white px-2 py-1 text-[11px] text-rose-900 outline-none focus:border-rose-500 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {Object.keys(answers).length > 0 && (
            <p className="mt-2 text-[10px] text-rose-500 dark:text-rose-500">
              回答将在「⑦ 生成」步被采纳，生成个性化方案。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
