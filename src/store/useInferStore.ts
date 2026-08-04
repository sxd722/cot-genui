"use client";

import { create } from "zustand";
import { presets, DEFAULT_QUERY, type DeviceContext } from "@/lib/presets";
import type { InferSlot, InferConflict, InferQuestion, InferResult } from "@/lib/schemas";

/* ----------------------- 类型 ----------------------- */

export type StepStatus = "pending" | "loading" | "done" | "error";

export interface StepLog {
  ts: string;
  phase: string;
  message: string;
  detail?: unknown;
}

export interface StepState {
  status: StepStatus;
  reasoning: string;
  outputs: Record<string, unknown>;
  durationMs: number;
  error: string | null;
  logs: StepLog[];
}

// 8 步固定顺序（⓪ 槽位定义 → ①~⑦ 推理）
export const STEP_ORDER = [
  "slot_definition",
  "surface_parse",
  "sufficiency_check",
  "context_mining",
  "conflict_detection",
  "triage",
  "clarifying_questions",
  "generate",
] as const;

export type StepName = (typeof STEP_ORDER)[number];

export const STEP_LABEL: Record<StepName, string> = {
  slot_definition: "⓪ 槽位定义",
  surface_parse: "① 表层解析",
  sufficiency_check: "② 充分性判定",
  context_mining: "③ 上下文挖掘",
  conflict_detection: "④ 冲突检测",
  triage: "⑤ 分流",
  clarifying_questions: "⑥ 最小化提问",
  generate: "⑦ 生成",
};

/* ----------------------- store ----------------------- */

interface InferState {
  /* 输入 */
  query: string;
  deviceContext: DeviceContext;
  contextText: string;

  /* 每步状态 */
  steps: Record<StepName, StepState>;
  isMock: boolean;

  /* 汇总（逐步累积） */
  slots: InferSlot[];
  conflicts: InferConflict[];
  questions: InferQuestion[];
  result: InferResult | null;

  /* 用户对提问的回答（模拟交互），key = 问题在 questions 数组中的索引 */
  answers: Record<number, string>;

  /* actions */
  setQuery: (q: string) => void;
  selectPreset: (id: string) => void;
  setContextText: (t: string) => void;
  answerQuestion: (idx: number, value: string) => void;
  runStep: (name: StepName) => Promise<void>;
  runAll: () => Promise<void>;
  reset: () => void;
}

function pretty(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

function emptySteps(): Record<StepName, StepState> {
  const init = {
    status: "pending" as StepStatus,
    reasoning: "",
    outputs: {} as Record<string, unknown>,
    durationMs: 0,
    error: null,
    logs: [] as StepLog[],
  };
  return {
    slot_definition: { ...init },
    surface_parse: { ...init },
    sufficiency_check: { ...init },
    context_mining: { ...init },
    conflict_detection: { ...init },
    triage: { ...init },
    clarifying_questions: { ...init },
    generate: { ...init },
  };
}

/** 从已完成的步骤构造 priorSteps（发给后端的上下文） */
function buildPriorSteps(
  steps: Record<StepName, StepState>,
  upTo: StepName,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of STEP_ORDER) {
    if (name === upTo) break;
    const s = steps[name];
    if (s.status === "done") {
      out[name] = { reasoning: s.reasoning, outputs: s.outputs };
    }
  }
  return out;
}

export const useInferStore = create<InferState>((set, get) => ({
  query: DEFAULT_QUERY,
  deviceContext: presets[0],
  contextText: pretty(presets[0].records),

  steps: emptySteps(),
  isMock: false,
  slots: [],
  conflicts: [],
  questions: [],
  result: null,
  answers: {},

  setQuery: (q) => set({ query: q }),

  selectPreset: (id) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    set({
      deviceContext: p,
      contextText: pretty(p.records),
      steps: emptySteps(),
      isMock: false,
      slots: [],
      conflicts: [],
      questions: [],
      result: null,
      answers: {},
    });
  },

  setContextText: (t) => set({ contextText: t }),

  answerQuestion: (idx, value) =>
    set((st) => ({ answers: { ...st.answers, [idx]: value } })),

  runStep: async (name) => {
    const { query, contextText, steps } = get();

    let deviceContext: Record<string, unknown>;
    try {
      deviceContext = JSON.parse(contextText);
    } catch {
      set((st) => ({
        steps: { ...st.steps, [name]: { ...st.steps[name], status: "error", error: "设备上下文不是合法 JSON" } },
      }));
      return;
    }

    // 标记 loading
    set((st) => ({
      steps: { ...st.steps, [name]: { ...st.steps[name], status: "loading", error: null, logs: [] } },
    }));

    const priorSteps = buildPriorSteps(get().steps, name);

    try {
      const { answers } = get();
      const res = await fetch("/api/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // generate 步把用户回答一起带上，影响最终方案
        body: JSON.stringify({
          query,
          deviceContext,
          step: name,
          priorSteps,
          ...(name === "generate" && Object.keys(answers).length > 0
            ? { userAnswers: answers }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        set((st) => ({
          steps: {
            ...st.steps,
            [name]: {
              ...st.steps[name],
              status: "error",
              error: data.error ?? "推理失败",
              logs: data._logs ?? [],
            },
          },
        }));
        return;
      }

      const { _mock, _logs, reasoning, outputs, durationMs } = data;

      // 累积汇总字段（slots/conflicts/questions/result 由对应步骤覆盖）
      set((st) => {
        const nextSlots = data.slots ?? st.slots;
        const nextConflicts = data.conflicts ?? st.conflicts;
        const nextQuestions = data.questions ?? st.questions;
        const nextResult = data.result ?? st.result;
        return {
          isMock: !!_mock,
          slots: nextSlots,
          conflicts: nextConflicts,
          questions: nextQuestions,
          result: nextResult,
          // clarifying_questions 步成功后，问题可能已变化，
          // 旧 answers 按 idx 存会与新问题错位，故清空。
          ...(name === "clarifying_questions" ? { answers: {} } : {}),
          steps: {
            ...st.steps,
            [name]: {
              status: "done",
              reasoning: reasoning ?? "",
              outputs: outputs ?? {},
              durationMs: durationMs ?? 0,
              error: null,
              logs: _logs ?? [],
            },
          },
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "网络错误";
      set((st) => ({
        steps: { ...st.steps, [name]: { ...st.steps[name], status: "error", error: message } },
      }));
    }
  },

  runAll: async () => {
    for (const name of STEP_ORDER) {
      await get().runStep(name);
      // 若某步失败则停止后续
      if (get().steps[name].status === "error") break;
    }
  },

  reset: () =>
    set({
      query: DEFAULT_QUERY,
      deviceContext: presets[0],
      contextText: pretty(presets[0].records),
      steps: emptySteps(),
      isMock: false,
      slots: [],
      conflicts: [],
      questions: [],
      result: null,
      answers: {},
    }),
}));
