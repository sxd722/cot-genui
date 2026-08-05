/**
 * Mini Runtime（spec §6 State 与 Binding，§8.1 Local Action）
 *
 * 持有六类命名空间的状态，处理本地动作的状态变更。
 * 纯逻辑层，不依赖 React。React 适配层（DslCardHost）通过此模块驱动 UI。
 */

import type {
  CardArtifact,
  RuntimeState,
  Action,
  InitialState,
  Binding,
  Formatter,
} from "./types";
import { localActionEvent } from "./reducer";

/* ------------------------------------------------------------------ */
/*  状态初始化                                                          */
/* ------------------------------------------------------------------ */

/** 从 artifact 的 initialState 构造完整 RuntimeState（补齐缺失命名空间） */
export function createRuntimeState(artifact: CardArtifact): RuntimeState {
  const init: InitialState = artifact.dsl.initialState ?? {};
  return {
    strings: { ...(init.strings ?? {}) },
    numbers: { ...(init.numbers ?? {}) },
    booleans: { ...(init.booleans ?? {}) },
    stringLists: { ...(init.stringLists ?? {}) },
    numberLists: { ...(init.numberLists ?? {}) },
    objectsJson: { ...(init.objectsJson ?? {}) },
  };
}

/* ------------------------------------------------------------------ */
/*  状态读取（Binding 解析）                                            */
/* ------------------------------------------------------------------ */

/**
 * 按 path（如 "strings.selectedFileName"）读取运行时状态值。
 * 返回 unknown；调用方按预期类型使用。
 */
export function readState(state: RuntimeState, path: string): unknown {
  if (!path) return undefined;
  const dot = path.indexOf(".");
  if (dot < 0) return undefined;
  const ns = path.slice(0, dot);
  const key = path.slice(dot + 1);
  const bucket = state[ns as keyof RuntimeState];
  if (!bucket || typeof bucket !== "object") return undefined;
  return (bucket as Record<string, unknown>)[key];
}

/**
 * 解析一个 Binding：读 state，缺失用 fallback，按 formatter 格式化。
 * 返回最终用于显示的字符串。
 */
export function resolveBinding(
  state: RuntimeState,
  binding: Binding | undefined,
): string {
  if (!binding) return "";
  const raw = readState(state, binding.path);
  if (raw === undefined || raw === null || raw === "") {
    return binding.fallback ?? "";
  }
  return formatValue(raw, binding.formatter ?? "plain");
}

/** 按 formatter 格式化原始值 */
export function formatValue(value: unknown, formatter: Formatter): string {
  switch (formatter) {
    case "plain":
      return String(value);
    case "percent":
      // number 0-100 → "42%"
      return typeof value === "number" ? `${Math.round(value)}%` : String(value);
    case "bytes":
      return typeof value === "number" ? formatBytes(value) : String(value);
    case "pageCounter":
      // 期望绑定到 currentPage，配合 totalPages 显示 "1 / 10"
      return String(value);
    case "date":
      return String(value);
    case "join":
      // 列表 → 紧凑文本
      return Array.isArray(value) ? value.join("、") : String(value);
    default:
      return String(value);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/* ------------------------------------------------------------------ */
/*  本地动作执行                                                        */
/* ------------------------------------------------------------------ */

/** 本地动作执行结果：新 state + 触发的事件 */
export interface LocalActionResult {
  state: RuntimeState;
  /** 该动作触发的事件名（用于 flow 转移）；无事件时为 null */
  event: string | null;
}

/**
 * 执行一个 local action 的状态变更（spec §8.1）。
 * 返回新的 state 副本 + 触发的事件。不修改原 state。
 */
export function applyLocalAction(
  state: RuntimeState,
  action: Action,
): LocalActionResult {
  // 深拷贝（state 不大，简单 JSON 方式即可）
  const next: RuntimeState = JSON.parse(JSON.stringify(state));
  const op = action.operation ?? "none";

  switch (op) {
    case "state.set": {
      // §8.1 v1 stateValue 是 string，只能写 strings.*
      if (action.statePath) {
        writeState(next, action.statePath, action.stateValue ?? "");
      }
      break;
    }
    case "state.toggle": {
      // statePath 必须是 boolean
      if (action.statePath) {
        const cur = readState(next, action.statePath);
        writeState(next, action.statePath, !cur);
      }
      break;
    }
    case "state.select": {
      // 把选项的 string value 写入 strings.*
      if (action.statePath && action.stateValue !== undefined) {
        writeState(next, action.statePath, action.stateValue);
      }
      break;
    }
    case "session.reset": {
      // 回到初始状态由调用方重新 createRuntimeState；这里标记，event 触发跳转到 startCardId
      break;
    }
    case "page.next":
    case "page.previous": {
      // pager 操作：在 numbers.currentPage 上增减
      adjustPage(next, op === "page.next" ? 1 : -1);
      break;
    }
    case "list.toggle": {
      // 简化：在 stringLists 上切换某项（需要 statePath + stateValue 指定项）
      // MVP 阶段做最小实现
      break;
    }
    case "none":
    default:
      // 纯导航，不改 state
      break;
  }

  // 计算触发的事件
  const event = op === "none" ? null : localActionEvent(action);
  return { state: next, event };
}

/** 写入状态值到指定 path（带命名空间） */
function writeState(state: RuntimeState, path: string, value: unknown): void {
  const dot = path.indexOf(".");
  if (dot < 0) return;
  const ns = path.slice(0, dot);
  const key = path.slice(dot + 1);
  const bucket = state[ns as keyof RuntimeState];
  if (bucket && typeof bucket === "object") {
    (bucket as Record<string, unknown>)[key] = value;
  }
}

/** 调整 currentPage（pager 操作） */
function adjustPage(state: RuntimeState, delta: number): void {
  const cur = (state.numbers.currentPage as number) ?? 1;
  const total = (state.numbers.totalPages as number) ?? 1;
  const next = Math.max(1, Math.min(total, cur + delta));
  state.numbers.currentPage = next;
}
