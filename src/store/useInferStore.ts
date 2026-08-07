"use client";

import { create } from "zustand";
import { presets, DEFAULT_QUERY, type DeviceContext } from "@/lib/presets";
import type { InferSlot, InferConflict, InferQuestion, InferResult } from "@/lib/schemas";
import { compileCardPlan } from "@/dsl/compiler";
import { enrichCardPlan, hasMissingInfo } from "@/dsl/enrichPlan";
import type { CardPlan } from "@/dsl/modules";

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
  /** token 消耗（从 _logs 里的 usage 提取） */
  tokens?: { prompt: number; completion: number; total: number };
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

  /** 第7步生成模式：ir=结构化CardPlan / semantic=纯语义描述 */
  genMode: "ir" | "semantic";

  /* 汇总（逐步累积） */
  slots: InferSlot[];
  conflicts: InferConflict[];
  questions: InferQuestion[];
  result: InferResult | null;

  /** generate 步产出的 CardPlan IR */
  cardPlan: unknown | null;
  /** generate 步产出的纯语义卡片描述（semantic 模式） */
  semanticCards: unknown | null;
  /** 编译后的 CardArtifact（generate 完成后自动编译） */
  compiledArtifact: unknown | null;
  /** 编译诊断 notices */
  compileNotices: import("@/dsl/modules").CompileNotice[];

  /** 信息补齐状态 */
  enrichStatus: "idle" | "scanning" | "enriching" | "done" | "skipped";
  enrichProgress: { done: number; total: number; current: string };
  enrichResults: import("@/dsl/enrichPlan").EnrichResult[];

  /* 用户对提问的回答（模拟交互），key = 问题在 questions 数组中的索引 */
  answers: Record<number, string>;

  /** 一键全部暂停状态（等用户回答提问后再继续 generate） */
  runAllPaused: boolean;

  /* actions */
  setQuery: (q: string) => void;
  selectPreset: (id: string) => void;
  setContextText: (t: string) => void;
  setGenMode: (mode: "ir" | "semantic") => void;
  answerQuestion: (idx: number, value: string) => void;
  /** 一键全部暂停后，用户回答完提问，继续执行 generate */
  continueGenerate: () => Promise<void>;
  /** generate 完成后：补齐 missingInfo → 编译 */
  enrichAndCompile: () => Promise<void>;
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

/** 从 _logs 里提取 token 消耗（callLLM 的 response log 含 detail.usage） */
function extractTokens(logs: StepLog[]): StepState["tokens"] {
  for (const l of logs) {
    const usage = (l.detail as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })?.usage;
    if (usage && (usage.total_tokens || usage.prompt_tokens)) {
      return {
        prompt: usage.prompt_tokens ?? 0,
        completion: usage.completion_tokens ?? 0,
        total: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
      };
    }
  }
  return undefined;
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
  genMode: "ir",
  runAllPaused: false,
  slots: [],
  conflicts: [],
  questions: [],
  result: null,
  cardPlan: null,
  semanticCards: null,
  compiledArtifact: null,
  compileNotices: [],
  enrichStatus: "idle",
  enrichProgress: { done: 0, total: 0, current: "" },
  enrichResults: [],
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
      cardPlan: null,
      semanticCards: null,
      compiledArtifact: null,
      compileNotices: [],
      enrichStatus: "idle",
      enrichProgress: { done: 0, total: 0, current: "" },
      enrichResults: [],
      runAllPaused: false,
      answers: {},
    });
  },

  setContextText: (t) => set({ contextText: t }),

  setGenMode: (mode) => set({ genMode: mode }),

  answerQuestion: (idx, value) =>
    set((st) => ({ answers: { ...st.answers, [idx]: value } })),

  enrichAndCompile: async () => {
    const { cardPlan } = get();
    if (!cardPlan) return;

    // 检查是否有 missingInfo
    if (!hasMissingInfo(cardPlan as CardPlan)) {
      // 无需补齐，直接编译
      set({ enrichStatus: "skipped", enrichResults: [] });
      try {
        const compiled = compileCardPlan(cardPlan as CardPlan);
        set({ compiledArtifact: compiled.artifact, compileNotices: compiled.notices });
      } catch (e) {
        set({
          compileNotices: [{
            level: "unsupported",
            message: `编译失败: ${e instanceof Error ? e.message : String(e)}`,
          }],
        });
      }
      return;
    }

    // 有 missingInfo，开始补齐
    set({ enrichStatus: "enriching", enrichProgress: { done: 0, total: 0, current: "扫描缺失信息…" } });

    try {
      const { enrichedPlan, results, notices } = await enrichCardPlan(
        cardPlan as CardPlan,
        (done, total, current) =>
          set({ enrichProgress: { done, total, current } }),
      );

      // 补齐后重新编译
      const compiled = compileCardPlan(enrichedPlan);
      set({
        cardPlan: enrichedPlan,
        compiledArtifact: compiled.artifact,
        compileNotices: [...compiled.notices, ...notices],
        enrichResults: results,
        enrichStatus: "done",
      });
    } catch (e) {
      // 补齐失败，用原始 plan 编译
      set({
        enrichStatus: "done",
        enrichResults: [],
        compileNotices: [{
          level: "info",
          message: `信息补齐异常: ${e instanceof Error ? e.message : String(e)}`,
        }],
      });
      try {
        const compiled = compileCardPlan(cardPlan as CardPlan);
        set({ compiledArtifact: compiled.artifact });
      } catch {
        /* 忽略 */
      }
    }
  },

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
      const { answers, genMode } = get();
      const res = await fetch("/api/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          deviceContext,
          step: name,
          priorSteps,
          // generate 步把用户回答和生成模式一起带上
          ...(name === "generate"
            ? {
                ...(Object.keys(answers).length > 0 ? { userAnswers: answers } : {}),
                genMode,
              }
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

        // generate 步：提取 cardPlan 或 semanticCards
        const isGen = name === "generate";
        const hasCardPlan = isGen && data.cardPlan;
        const hasSemantic = isGen && data.semanticCards;

        return {
          isMock: !!_mock,
          slots: nextSlots,
          conflicts: nextConflicts,
          questions: nextQuestions,
          result: nextResult,
          // generate 步：存 cardPlan（IR模式）或 semanticCards（语义模式）
          ...(hasCardPlan
            ? {
                cardPlan: data.cardPlan,
                semanticCards: null,
                compiledArtifact: null,
                compileNotices: [],
                enrichStatus: "scanning" as const,
                enrichProgress: { done: 0, total: 0, current: "" },
                enrichResults: [],
              }
            : {}),
          ...(hasSemantic
            ? {
                cardPlan: null,
                semanticCards: data.semanticCards,
                compiledArtifact: null,
                compileNotices: [],
                enrichStatus: "skipped" as const,
                enrichResults: [],
              }
            : {}),
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
              tokens: extractTokens(_logs ?? []),
              error: null,
              logs: _logs ?? [],
            },
          },
        };
      });

      // generate 步完成后：异步补齐 missingInfo + 编译
      if (name === "generate" && data.cardPlan) {
        // 不 await——让 UI 先更新，补齐在后台进行
        get().enrichAndCompile();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "网络错误";
      set((st) => ({
        steps: { ...st.steps, [name]: { ...st.steps[name], status: "error", error: message } },
      }));
    }
  },

  runAll: async () => {
    set({ runAllPaused: false });
    // 跑 ⓪~⑥（到 clarifying_questions 为止）
    for (const name of STEP_ORDER) {
      if (name === "generate") break; // generate 留给 continueGenerate
      await get().runStep(name);
      if (get().steps[name].status === "error") return;
    }
    // ⑥ 完成后：如果有提问且用户还没全答 → 暂停等用户
    const { questions, answers } = get();
    const unanswered = questions.filter((_, i) => !answers[i]);
    if (unanswered.length > 0) {
      set({ runAllPaused: true });
      return; // 等用户回答后点"继续生成"
    }
    // 没有提问或已全答 → 直接生成
    await get().runStep("generate");
  },

  continueGenerate: async () => {
    set({ runAllPaused: false });
    await get().runStep("generate");
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
      cardPlan: null,
      semanticCards: null,
      compiledArtifact: null,
      compileNotices: [],
      enrichStatus: "idle",
      enrichProgress: { done: 0, total: 0, current: "" },
      enrichResults: [],
      runAllPaused: false,
      answers: {},
    }),
}));
