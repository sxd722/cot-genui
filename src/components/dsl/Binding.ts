"use client";

import { useDslTheme } from "./ThemeProvider";
import { resolveBinding as resolve, formatValue } from "@/dsl/runtime";
import type { RuntimeState, Binding as BindingType } from "@/dsl/types";

/**
 * 从 runtime state 解析 binding 值（带 fallback 和 formatter）。
 * 这是个纯函数 hook 包装，给 block 组件用。
 */
export function useBinding(
  state: RuntimeState,
  binding: BindingType | undefined,
): string {
  if (!binding) return "";
  return resolve(state, binding);
}

/** 直接读原始值（不经 formatter），用于需要判断类型的场景 */
export function readRaw(state: RuntimeState, path: string): unknown {
  if (!path) return undefined;
  const dot = path.indexOf(".");
  if (dot < 0) return undefined;
  const ns = path.slice(0, dot);
  const key = path.slice(dot + 1);
  const bucket = state[ns as keyof RuntimeState];
  if (!bucket || typeof bucket !== "object") return undefined;
  return (bucket as Record<string, unknown>)[key];
}

/** 读取列表绑定值（stringLists / numberLists） */
export function readList(state: RuntimeState, binding: BindingType | undefined): string[] {
  if (!binding) return [];
  const raw = readRaw(state, binding.path);
  if (Array.isArray(raw)) return raw.map(String);
  // fallback 按 join 也不合适，直接返回空
  return [];
}

/** 主题色 hook（方便 block 取 accent/danger 色） */
export { useDslTheme };
export { formatValue };
