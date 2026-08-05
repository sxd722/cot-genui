"use client";

import type { ReactNode } from "react";
import type { Block, Action, RuntimeState } from "@/dsl/types";
import { useBinding, readRaw, readList } from "../Binding";
import { useDslTheme } from "../ThemeProvider";

/** block 组件的统一 props */
export interface BlockProps {
  block: Block;
  state: RuntimeState;
  /** 触发某 action（带可选的动态 stateValue，用于 choice/select） */
  onAction: (actionId: string, dynamicStateValue?: string) => void;
  /** 当前卡的所有 action（用于 block 找 actionId 对应的 action） */
  actions: Action[];
}

/* ----------------------- 8 种专门 block ----------------------- */

/** hero: 首屏大标题 + 说明 */
export function HeroBlock({ block, state }: BlockProps) {
  // hooks 必须无条件调用，先取 binding 值再决定用哪个
  const bound = useBinding(state, block.valueBinding);
  const text = block.text || bound;
  return (
    <div className="dsl-block-hero">
      {block.title && (
        <h2 className="text-[17px] font-bold leading-tight text-white">{block.title}</h2>
      )}
      {text && <p className="mt-1 text-[12px] leading-relaxed text-white/70">{text}</p>}
    </div>
  );
}

/** entity-summary: 主副两行摘要 */
export function EntitySummaryBlock({ block, state }: BlockProps) {
  const primary = useBinding(state, block.valueBinding);
  const secondary = useBinding(state, block.secondaryBinding);
  return (
    <div className="dsl-block-summary rounded-lg bg-white/[0.06] p-3">
      {block.title && (
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--dsl-accent)]">
          {block.title}
        </p>
      )}
      <p className="mt-0.5 text-[13px] font-semibold text-white">{primary || "—"}</p>
      {secondary && <p className="mt-0.5 text-[11px] text-white/60">{secondary}</p>}
    </div>
  );
}

/** choice: 横向按钮组（互斥选项） */
export function ChoiceBlock({ block, state, onAction, actions }: BlockProps) {
  const current = useBinding(state, block.valueBinding);
  const actionId = block.actionId;
  const action = actions.find((a) => a.id === actionId);
  const options = block.options ?? [];
  return (
    <div className="dsl-block-choice">
      {block.title && (
        <p className="text-[12px] font-medium text-white/90">{block.title}</p>
      )}
      {block.text && <p className="mt-0.5 text-[11px] text-white/50">{block.text}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selected = current === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => {
                if (action) onAction(action.id, opt.value);
              }}
              className={`rounded-full border px-3 py-1.5 text-[11px] transition-all ${
                selected
                  ? "border-[var(--dsl-accent)] bg-[var(--dsl-accent)] text-black"
                  : "border-white/20 text-white/80 hover:border-white/40"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** toggle: 布尔开关 */
export function ToggleBlock({ block, state, onAction, actions }: BlockProps) {
  const raw = block.valueBinding ? readRaw(state, block.valueBinding.path) : false;
  const on = raw === true;
  const actionId = block.actionId;
  const action = actions.find((a) => a.id === actionId);
  return (
    <div className="dsl-block-toggle flex items-center justify-between rounded-lg bg-white/[0.06] p-3">
      <div>
        {block.title && <p className="text-[12px] font-medium text-white/90">{block.title}</p>}
        {block.text && <p className="text-[10px] text-white/50">{block.text}</p>}
      </div>
      <button
        onClick={() => action && onAction(action.id)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          on ? "bg-[var(--dsl-accent)]" : "bg-white/20"
        }`}
        aria-pressed={on}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

/** progress: 进度条 */
export function ProgressBlock({ block, state }: BlockProps) {
  const raw = block.valueBinding ? readRaw(state, block.valueBinding.path) : 0;
  const pct = typeof raw === "number" ? Math.min(100, Math.max(0, raw)) : 0;
  const status = useBinding(state, block.secondaryBinding);
  return (
    <div className="dsl-block-progress">
      {block.title && <p className="text-[12px] font-medium text-white/90">{block.title}</p>}
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[var(--dsl-accent)] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-white/60">
        <span>{status}</span>
        <span>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

/** status: 状态面板（含 danger tone） */
export function StatusBlock({ block, state }: BlockProps) {
  const { dangerToken } = useDslTheme();
  const isDanger = block.tone === "danger";
  const value = useBinding(state, block.valueBinding);
  return (
    <div
      className="dsl-block-status rounded-lg p-3"
      style={{
        background: isDanger ? `${dangerToken}1a` : "rgba(215,174,89,0.1)",
        border: `1px solid ${isDanger ? dangerToken : "var(--dsl-accent)"}40`,
      }}
    >
      {block.title && (
        <p className="text-[13px] font-bold" style={{ color: isDanger ? dangerToken : "var(--dsl-accent)" }}>
          {block.title}
        </p>
      )}
      {block.text && <p className="mt-0.5 text-[11px] text-white/70">{block.text}</p>}
      {value && <p className="mt-1 text-[11px] text-white/90">{value}</p>}
    </div>
  );
}

/** text-preview: 多页文字预览 */
export function TextPreviewBlock({ block, state }: BlockProps) {
  const text = useBinding(state, block.valueBinding);
  return (
    <div className="dsl-block-preview rounded-lg bg-white/[0.04] p-3">
      {block.title && <p className="text-[10px] text-white/50">{block.title}</p>}
      <p className="mt-1 line-clamp-8 whitespace-pre-wrap text-[12px] leading-relaxed text-white/80">
        {text || "（无预览内容）"}
      </p>
    </div>
  );
}

/** pager: 上一页/下一页（内建按钮，触发 page.next/page.previous） */
export function PagerBlock({ block, state, onAction, actions }: BlockProps) {
  const cur = block.valueBinding ? Number(readRaw(state, block.valueBinding.path) ?? 1) : 1;
  const total = block.secondaryBinding ? Number(readRaw(state, block.secondaryBinding.path) ?? 1) : 1;
  const next = actions.find((a) => a.operation === "page.next");
  const prev = actions.find((a) => a.operation === "page.previous");
  return (
    <div className="dsl-block-pager flex items-center justify-between rounded-lg bg-white/[0.06] p-2">
      <button
        onClick={() => prev && onAction(prev.id)}
        disabled={cur <= 1}
        className="rounded px-2 py-1 text-[11px] text-white/70 enabled:hover:bg-white/10 disabled:opacity-30"
      >
        ‹ 上一页
      </button>
      <span className="text-[11px] text-white/60">
        {cur} / {total}
      </span>
      <button
        onClick={() => next && onAction(next.id)}
        disabled={cur >= total}
        className="rounded px-2 py-1 text-[11px] text-white/70 enabled:hover:bg-white/10 disabled:opacity-30"
      >
        下一页 ›
      </button>
    </div>
  );
}

/* ----------------------- 通用降级 block ----------------------- */

/** text / key-value / list / illustration 的通用降级渲染 */
export function FallbackBlock({ block, state }: BlockProps) {
  // 所有 hooks 无条件调用（避免条件 hook）
  const boundValue = useBinding(state, block.valueBinding);
  const listItems =
    block.kind === "list" && block.itemsBinding ? readList(state, block.itemsBinding) : [];

  // list: 用 itemsBinding 读列表
  if (block.kind === "list") {
    const max = block.maxItems ?? 5;
    return (
      <div className="dsl-block-list">
        {block.title && <p className="text-[12px] font-medium text-white/90">{block.title}</p>}
        <ul className="mt-1.5 flex flex-col gap-1">
          {listItems.slice(0, max).map((it, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-white/70">
              <span className="mt-0.5 text-[var(--dsl-accent)]">•</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // key-value: 单项指标
  if (block.kind === "key-value") {
    return (
      <div className="dsl-block-kv flex items-center justify-between rounded-lg bg-white/[0.06] px-3 py-2">
        <span className="text-[11px] text-white/60">{block.title}</span>
        <span className="text-[12px] font-medium text-white">{boundValue || "—"}</span>
      </div>
    );
  }

  // text / illustration 通用
  return (
    <div className="dsl-block-text">
      {block.title && <p className="text-[12px] font-medium text-white/90">{block.title}</p>}
      {(block.text || boundValue) && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-white/60">{block.text || boundValue}</p>
      )}
    </div>
  );
}

/* ----------------------- 分发器 ----------------------- */

/** 按 block.kind 分发到对应组件 */
export function renderBlock(props: BlockProps): ReactNode {
  const { kind } = props.block;
  switch (kind) {
    case "hero":
      return <HeroBlock {...props} />;
    case "entity-summary":
      return <EntitySummaryBlock {...props} />;
    case "choice":
      return <ChoiceBlock {...props} />;
    case "toggle":
      return <ToggleBlock {...props} />;
    case "progress":
      return <ProgressBlock {...props} />;
    case "status":
      return <StatusBlock {...props} />;
    case "text-preview":
      return <TextPreviewBlock {...props} />;
    case "pager":
      return <PagerBlock {...props} />;
    // text / key-value / list / illustration → 降级
    default:
      return <FallbackBlock {...props} />;
  }
}
