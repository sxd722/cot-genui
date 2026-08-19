"use client";

import { useInferStore } from "@/store/useInferStore";
import { toText } from "@/lib/format";

export function ResultPanel() {
  const { result } = useInferStore();

  return (
    <aside className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">结构化结果</h2>

      {!result ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-center text-xs text-zinc-400">
            执行「⑤ CardPlan 生成」后，
            <br />
            CardPlan 与 OpenUI 产物会显示在这里
          </p>
        </div>
      ) : (
        <>
          {/* 方案总结 */}
          {result.summary && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                方案总结
              </h3>
              <p className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-white p-2.5 text-xs leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {toText(result.summary)}
              </p>
            </div>
          )}

          {/* 假设清单 */}
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              替你做的假设（可纠正）
            </h3>
            {(() => {
              // 容错：assumptions 可能是数组/字符串/null/对象
              const raw = result.assumptions;
              const items = Array.isArray(raw)
                ? raw
                : typeof raw === "string"
                  ? [raw]
                  : [];
              return items.length === 0 ? (
                <p className="text-xs text-zinc-400">无</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {items.map((a, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                    >
                      <span className="mt-0.5 text-amber-500">•</span>
                      <span>{toText(a)}</span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
        </>
      )}
    </aside>
  );
}
