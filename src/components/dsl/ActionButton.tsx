"use client";

import type { Action } from "@/dsl/types";

/** action 按钮的样式由 role 决定（spec §3 ActionRole） */
const ROLE_STYLES: Record<string, string> = {
  primary:
    "bg-[var(--dsl-accent)] text-black font-semibold hover:brightness-110",
  secondary:
    "border border-white/25 text-white/90 hover:border-white/50 hover:bg-white/5",
  tertiary:
    "text-white/50 text-[11px] hover:text-white/80",
};

/** 单个 action 按钮。pager 的前后翻页由 PagerBlock 内建，不走这里。 */
export function ActionButton({
  action,
  onClick,
}: {
  action: Action;
  onClick: () => void;
}) {
  const cls = ROLE_STYLES[action.role ?? "secondary"] ?? ROLE_STYLES.secondary;
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg px-3 py-2 text-[12px] transition-all ${cls}`}
    >
      {action.label}
    </button>
  );
}
