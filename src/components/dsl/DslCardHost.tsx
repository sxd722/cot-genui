"use client";

import { useReducer, useMemo, useState, useEffect } from "react";
import type { CardArtifact, RuntimeState } from "@/dsl/types";
import { validateArtifact } from "@/dsl/validate";
import { createRuntimeState, applyLocalAction } from "@/dsl/runtime";
import {
  resolveTransition,
  getFlowCardTransitions,
  localActionEvent,
  toolActionEvent,
} from "@/dsl/reducer";
import { executeTool } from "@/dsl/toolExecutor";
import { DslThemeProvider } from "./ThemeProvider";
import { DslCardView } from "./DslCardView";

/* ----------------------- reducer ----------------------- */

interface HostState {
  currentCardId: string;
  state: RuntimeState;
  /** 工具执行中的 actionId（用于 loading 态） */
  pendingTool: string | null;
}

type HostAction =
  | { type: "TRIGGER"; actionId: string; dynamicStateValue?: string }
  | { type: "TOOL_RESULT"; actionId: string; outcome: string; stateUpdates?: Record<string, unknown> }
  | { type: "RESET" };

function makeReducer(artifact: CardArtifact) {
  return function reducer(s: HostState, a: HostAction): HostState {
    switch (a.type) {
      case "TRIGGER": {
        // 找当前卡的 action
        const card = artifact.dsl.cards.find((c) => c.id === s.currentCardId);
        if (!card) return s;
        const action = card.actions.find((x) => x.id === a.actionId);
        if (!action) return s;

        // 合并动态 stateValue（choice/select 场景）
        const effectiveAction =
          a.dynamicStateValue !== undefined
            ? { ...action, stateValue: a.dynamicStateValue }
            : action;

        if (action.kind === "local") {
          // 本地动作：变更状态 + 算事件
          const result = applyLocalAction(s.state, effectiveAction);

          // session.reset：回到初始 state
          let nextState = result.state;
          if (action.operation === "session.reset") {
            nextState = createRuntimeState(artifact);
          }

          // 算事件并跳转
          const evt =
            action.operation === "none"
              ? localActionEvent(action)
              : result.event ?? localActionEvent(action);
          const transitions = getFlowCardTransitions(artifact, s.currentCardId);
          const target = resolveTransition(transitions, evt);
          return {
            ...s,
            state: nextState,
            currentCardId: target ?? s.currentCardId,
            pendingTool: null,
          };
        }

        // tool 动作：进入 pending，等待模拟结果
        return { ...s, pendingTool: action.id };
      }

      case "TOOL_RESULT": {
        // 工具完成：写入 stateUpdates + 按 outcome 跳转
        const evt = toolActionEvent(a.actionId, a.outcome);
        const transitions = getFlowCardTransitions(artifact, s.currentCardId);
        const target = resolveTransition(transitions, evt);
        // 应用工具返回的 state 更新
        let nextState = s.state;
        if (a.stateUpdates) {
          nextState = JSON.parse(JSON.stringify(s.state));
          for (const [path, val] of Object.entries(a.stateUpdates)) {
            const dot = path.indexOf(".");
            if (dot < 0) continue;
            const ns = path.slice(0, dot);
            const key = path.slice(dot + 1);
            const bucket = nextState[ns as keyof typeof nextState];
            if (bucket && typeof bucket === "object") {
              (bucket as Record<string, unknown>)[key] = val;
            }
          }
        }
        return {
          ...s,
          state: nextState,
          currentCardId: target ?? s.currentCardId,
          pendingTool: null,
        };
      }

      case "RESET":
        return {
          currentCardId: artifact.dsl.startCardId,
          state: createRuntimeState(artifact),
          pendingTool: null,
        };

      default:
        return s;
    }
  };
}

/* ----------------------- 组件 ----------------------- */

export function DslCardHost({ artifact }: { artifact: unknown }) {
  // 1. 校验
  const validation = useMemo(() => validateArtifact(artifact), [artifact]);

  if (!validation.valid) {
    return <DslValidationErrors errors={validation.errors} />;
  }

  return <DslCardHostInner artifact={artifact as CardArtifact} />;
}

function DslCardHostInner({ artifact }: { artifact: CardArtifact }) {
  const [state, dispatch] = useReducer(
    makeReducer(artifact),
    { currentCardId: artifact.dsl.startCardId, state: createRuntimeState(artifact), pendingTool: null },
  );

  // 工具执行：pendingTool 设置后，调用真实 toolExecutor
  const pendingAction = state.pendingTool;
  const [toolMessage, setToolMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingAction) return;
    const card = artifact.dsl.cards.find((c) => c.id === state.currentCardId);
    const action = card?.actions.find((x) => x.id === pendingAction);
    if (!action?.toolCall) return;
    setToolMessage("执行中…");
    let cancelled = false;
    executeTool({ action, state: state.state, cardId: state.currentCardId })
      .then((result) => {
        if (cancelled) return;
        setToolMessage(result.message ?? null);
        dispatch({
          type: "TOOL_RESULT",
          actionId: pendingAction,
          outcome: result.outcome,
          stateUpdates: result.stateUpdates,
        });
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "TOOL_RESULT", actionId: pendingAction, outcome: "error" });
      });
    return () => { cancelled = true; };
  }, [pendingAction, artifact, state.currentCardId, state.state]);

  const card = artifact.dsl.cards.find((c) => c.id === state.currentCardId);
  if (!card) {
    return <div className="p-4 text-xs text-rose-400">找不到卡片 {state.currentCardId}</div>;
  }

  const handleAction = (actionId: string, dynamicStateValue?: string) => {
    dispatch({ type: "TRIGGER", actionId, dynamicStateValue });
  };

  // flow 进度
  const cardIndex = artifact.dsl.cards.findIndex((c) => c.id === state.currentCardId);
  const total = artifact.dsl.cards.length;

  return (
    <DslThemeProvider theme={artifact.dsl.theme}>
      <div className="flex h-full flex-col">
        {/* 进度指示 */}
        <div className="flex shrink-0 items-center justify-between px-1 pb-1.5">
          <span className="text-[10px] text-white/40">
            卡片 {cardIndex + 1} / {total}
          </span>
          {state.pendingTool && (
            <span className="text-[10px] text-[var(--dsl-accent)] animate-pulse">
              {toolMessage ?? "执行中…"}
            </span>
          )}
        </div>

        {/* 4x4 卡片预览区 */}
        <div
          className="relative flex-1 overflow-hidden rounded-2xl p-4"
          style={{ background: "var(--dsl-surface)", minHeight: "320px" }}
        >
          <DslCardView card={card} state={state.state} onAction={handleAction} />
        </div>

        {/* 底部：重置 + 查看原始 artifact */}
        <DslCardFooter artifact={artifact} onReset={() => dispatch({ type: "RESET" })} />
      </div>
    </DslThemeProvider>
  );
}

/* ----------------------- 子组件 ----------------------- */

function DslValidationErrors({ errors }: { errors: string[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
      <div className="text-3xl">⚠️</div>
      <p className="text-sm font-medium text-rose-500">CardArtifact 校验失败</p>
      <p className="text-[11px] text-zinc-500">{errors.length} 处问题</p>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
      >
        {open ? "隐藏" : "查看"} 诊断详情
      </button>
      {open && (
        <ul className="max-h-[300px] overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 p-2 dark:border-rose-900 dark:bg-rose-950/40">
          {errors.map((e, i) => (
            <li key={i} className="text-[10px] leading-relaxed text-rose-700 dark:text-rose-400">
              • {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DslCardFooter({
  artifact,
  onReset,
}: {
  artifact: CardArtifact;
  onReset: () => void;
}) {
  const [showJson, setShowJson] = useState(false);
  return (
    <div className="mt-2 shrink-0">
      <div className="flex items-center justify-between">
        <button
          onClick={onReset}
          className="rounded border border-zinc-300 px-2 py-1 text-[10px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
        >
          ↺ 重置流程
        </button>
        <button
          onClick={() => setShowJson((s) => !s)}
          className="rounded border border-zinc-300 px-2 py-1 text-[10px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
        >
          {showJson ? "隐藏" : "查看"} Artifact JSON
        </button>
      </div>
      {showJson && (
        <pre className="mt-1.5 max-h-[200px] overflow-auto rounded-lg bg-zinc-100 p-2 text-[9px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          {JSON.stringify(artifact, null, 2)}
        </pre>
      )}
    </div>
  );
}
