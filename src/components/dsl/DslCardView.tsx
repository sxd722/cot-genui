"use client";

import type { Card, RuntimeState, Action } from "@/dsl/types";
import { renderBlock } from "./blocks";
import { ActionButton } from "./ActionButton";

/** 渲染单张卡片：header + blocks + actions */
export function DslCardView({
  card,
  state,
  onAction,
}: {
  card: Card;
  state: RuntimeState;
  onAction: (actionId: string, dynamicStateValue?: string) => void;
}) {
  const { header } = card;
  // pager 类型的 action 不在底部渲染（由 PagerBlock 内建）
  const visibleActions: Action[] = (card.actions ?? []).filter(
    (a) => a.operation !== "page.next" && a.operation !== "page.previous",
  );

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 pb-2">
        {header.iconText && (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--dsl-accent)] text-[13px] font-bold text-black">
            {header.iconText}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-white">{header.skillName}</p>
          {header.stepLabel && (
            <p className="truncate text-[10px] text-white/40">{header.stepLabel}</p>
          )}
        </div>
      </div>

      {/* blocks */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto py-3">
        {(card.blocks ?? []).map((block) => (
          <div key={block.id}>{renderBlock({ block, state, onAction, actions: card.actions })}</div>
        ))}
      </div>

      {/* actions */}
      {visibleActions.length > 0 && (
        <div className="flex shrink-0 flex-col gap-1.5 border-t border-white/10 pt-2">
          {visibleActions.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              onClick={() => onAction(action.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
