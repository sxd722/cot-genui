"use client";

import { create } from "zustand";
import { presets, DEFAULT_QUERY, type DeviceContext } from "@/lib/presets";
import type { InferSlot, InferConflict, InferQuestion, InferResult } from "@/lib/schemas";
import { PIPELINE_STEPS, type InferenceState, type ModelProfile, type PipelineStepName, type StepTiming, type TokenUsage } from "@/lib/pipelineTypes";
import { compileCardPlan } from "@/dsl/compiler";
import { enrichCardPlan, hasMissingInfo } from "@/dsl/enrichPlan";
import type { CardPlan, CompileNotice } from "@/dsl/modules";
import type { ProfileDigest } from "@/lib/profileTypes";

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
  timing?: StepTiming;
  model?: string;
  modelProfile?: ModelProfile;
  tokens?: TokenUsage;
  cost?: number;
  error: string | null;
  logs: StepLog[];
}

interface SearchPrefetch {
  searchQuery: string;
  webSearchRaw: unknown;
  fetchedAt: number;
}

export const STEP_ORDER = PIPELINE_STEPS;
export type StepName = PipelineStepName;

export const STEP_LABEL: Record<StepName, string> = {
  intent_analysis: "① 意图建模",
  evidence_resolution: "② 证据解析",
  clarification: "③ 不确定性提问",
  context_enrichment: "④ 总结与能力补齐",
  card_plan_generate: "⑤ CardPlan 生成",
  a2ui_generate: "⑥ A2UI 生成",
};

interface InferState {
  query: string;
  deviceContext: DeviceContext;
  contextText: string;
  steps: Record<StepName, StepState>;
  stepModels: Record<StepName, ModelProfile>;
  isMock: boolean;
  profileStatus: "idle" | "compressing" | "ready" | "degraded" | "error";
  profileDigest: ProfileDigest | null;
  profileError: string | null;
  profileContextText: string | null;
  /** 自由文本个人上下文 */
  customContextText: string;
  inferenceState: InferenceState | null;
  slots: InferSlot[];
  conflicts: InferConflict[];
  questions: InferQuestion[];
  result: InferResult | null;
  cardPlan: CardPlan | null;
  semanticMarkdown: string | null;
  reasoningGraph: string | null;
  a2uiJsonl: unknown[] | null;
  a2uiBlueprint: unknown | null;
  compiledArtifact: unknown | null;
  compileNotices: CompileNotice[];
  enrichStatus: "idle" | "scanning" | "enriching" | "done" | "skipped";
  enrichProgress: { done: number; total: number; current: string };
  enrichResults: import("@/dsl/enrichPlan").EnrichResult[];
  answers: Record<number, string>;
  runAllPaused: boolean;
  prefetchedSearch: SearchPrefetch | null;
  prefetchStatus: "idle" | "loading" | "ready" | "error";
  setQuery: (query: string) => void;
  selectPreset: (id: string) => void;
  setContextText: (text: string) => void;
  setCustomContextText: (text: string) => void;
  answerQuestion: (index: number, value: string) => void;
  setStepModel: (name: StepName, profile: ModelProfile) => void;
  ensureProfileDigest: () => Promise<ProfileDigest | null>;
  prefetchSearch: () => Promise<void>;
  continueGenerate: () => Promise<void>;
  enrichAndCompile: () => Promise<void>;
  runStep: (name: StepName) => Promise<void>;
  runAll: () => Promise<void>;
  reset: () => void;
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function emptyStep(): StepState {
  return { status: "pending", reasoning: "", outputs: {}, durationMs: 0, error: null, logs: [] };
}

function emptySteps(): Record<StepName, StepState> {
  return {
    intent_analysis: emptyStep(),
    evidence_resolution: emptyStep(),
    clarification: emptyStep(),
    context_enrichment: emptyStep(),
    card_plan_generate: emptyStep(),
    a2ui_generate: emptyStep(),
  };
}

function defaultStepModels(): Record<StepName, ModelProfile> {
  return {
    intent_analysis: "glm_4_7_flash",
    evidence_resolution: "glm_4_7_flash",
    clarification: "glm_5_2",
    context_enrichment: "glm_5_2",
    card_plan_generate: "glm_5_2_thinking",
    a2ui_generate: "glm_5_2_thinking",
  };
}

function clearedResult() {
  return {
    inferenceState: null,
    slots: [] as InferSlot[], conflicts: [] as InferConflict[], questions: [] as InferQuestion[],
    result: null, cardPlan: null, semanticMarkdown: null, reasoningGraph: null, a2uiJsonl: null, a2uiBlueprint: null,
    compiledArtifact: null, compileNotices: [] as CompileNotice[], enrichStatus: "idle" as const,
    enrichProgress: { done: 0, total: 0, current: "" }, enrichResults: [], answers: {}, runAllPaused: false,
    prefetchedSearch: null as SearchPrefetch | null, prefetchStatus: "idle" as const,
  };
}

let pendingProfileRequest: Promise<ProfileDigest | null> | null = null;

export const useInferStore = create<InferState>((set, get) => ({
  query: DEFAULT_QUERY,
  deviceContext: presets[0],
  contextText: pretty(presets[0].records),
  steps: emptySteps(),
  stepModels: defaultStepModels(),
  isMock: false,
  profileStatus: "idle",
  profileDigest: null,
  profileError: null,
  profileContextText: null,
  customContextText: "",
  ...clearedResult(),

  setQuery: (query) => set({ query, prefetchedSearch: null, prefetchStatus: "idle" }),
  setContextText: (contextText) => set({ contextText, profileStatus: "idle", profileDigest: null, profileError: null, profileContextText: null, steps: emptySteps(), ...clearedResult() }),
  setCustomContextText: (text) => set({ customContextText: text }),
  answerQuestion: (index, value) => set((state) => ({ answers: { ...state.answers, [index]: value } })),
  setStepModel: (name, profile) => set((state) => ({
    stepModels: { ...state.stepModels, [name]: profile },
    steps: { ...state.steps, [name]: emptyStep() },
  })),

  selectPreset: (id) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    set({ deviceContext: preset, contextText: pretty(preset.records), steps: emptySteps(), isMock: false, profileStatus: "idle", profileDigest: null, profileError: null, profileContextText: null, ...clearedResult() });
    void get().ensureProfileDigest();
  },

  ensureProfileDigest: async () => {
    const state = get();
    const customText = state.customContextText.trim();
    // 如果有自定义文本，走 free-text 画像路径
    const useFreeText = customText.length > 20;
    const sourceKey = useFreeText ? `freetext:${customText}` : state.contextText;
    if (state.profileDigest && state.profileContextText === sourceKey) return state.profileDigest;
    if (pendingProfileRequest && state.profileStatus === "compressing") return pendingProfileRequest;
    set({ profileStatus: "compressing", profileError: null });
    pendingProfileRequest = (async () => {
      try {
        let response: Response;
        if (useFreeText) {
          response = await fetch("/api/profile/compress-free-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ freeText: customText }),
          });
        } else {
          let deviceContext: Record<string, unknown>;
          try { deviceContext = JSON.parse(state.contextText); }
          catch { set({ profileStatus: "error", profileError: "设备上下文不是合法 JSON" }); return null; }
          response = await fetch("/api/profile/compress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceContext }),
          });
        }
        const data = await response.json();
        if (!response.ok || !data.digest) throw new Error(data.error ?? "画像压缩失败");
        if (get().customContextText.trim() !== customText && get().contextText !== state.contextText) return null;
        const digest = data.digest as ProfileDigest;
        set({ profileDigest: digest, profileContextText: sourceKey, profileStatus: digest.degraded ? "degraded" : "ready", profileError: null });
        return digest;
      } catch (error) {
        set({ profileStatus: "error", profileError: error instanceof Error ? error.message : "画像压缩失败" });
        return null;
      } finally {
        pendingProfileRequest = null;
      }
    })();
    return pendingProfileRequest;
  },

  prefetchSearch: async () => {
    const { query, inferenceState } = get();
    if (!inferenceState) return;
    set({ prefetchStatus: "loading" });
    try {
      const response = await fetch("/api/prefetch-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, inferenceState }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "预取搜索失败");
      if (get().query !== query || get().inferenceState !== inferenceState) return;
      if (data.shouldSearch && data.webSearchRaw != null) {
        set({
          prefetchedSearch: { searchQuery: data.searchQuery, webSearchRaw: data.webSearchRaw, fetchedAt: Date.now() },
          prefetchStatus: "ready",
        });
      } else {
        set({ prefetchedSearch: null, prefetchStatus: "idle" });
      }
    } catch {
      if (get().query === query) set({ prefetchedSearch: null, prefetchStatus: "error" });
    }
  },

  enrichAndCompile: async () => {
    const plan = get().cardPlan;
    if (!plan) return;
    if (!hasMissingInfo(plan)) {
      try {
        const compiled = compileCardPlan(plan);
        set({ compiledArtifact: compiled.artifact, compileNotices: compiled.notices, enrichStatus: "skipped" });
      } catch (error) {
        set({ compileNotices: [{ level: "unsupported", message: `编译失败: ${error instanceof Error ? error.message : String(error)}` }], enrichStatus: "done" });
      }
      return;
    }

    set({ enrichStatus: "enriching", enrichProgress: { done: 0, total: 0, current: "扫描缺失信息…" } });
    try {
      const { enrichedPlan, results, notices } = await enrichCardPlan(plan, (done, total, current) => set({ enrichProgress: { done, total, current } }));
      const compiled = compileCardPlan(enrichedPlan);
      set({ cardPlan: enrichedPlan, compiledArtifact: compiled.artifact, compileNotices: [...compiled.notices, ...notices], enrichResults: results, enrichStatus: "done" });
    } catch (error) {
      set({ enrichStatus: "done", compileNotices: [{ level: "info", message: `信息补齐异常: ${error instanceof Error ? error.message : String(error)}` }] });
      try {
        const compiled = compileCardPlan(plan);
        set({ compiledArtifact: compiled.artifact });
      } catch {
        // 原始 CardPlan 也无法编译时，保留上面的诊断信息。
      }
    }
  },

  runStep: async (name) => {
    const { query, contextText } = get();
    let deviceContext: Record<string, unknown>;
    try {
      deviceContext = JSON.parse(contextText);
    } catch {
      set((state) => ({ steps: { ...state.steps, [name]: { ...state.steps[name], status: "error", error: "设备上下文不是合法 JSON" } } }));
      return;
    }

    set((state) => ({
      ...(name === "card_plan_generate" ? { result: null, cardPlan: null, semanticMarkdown: null, reasoningGraph: null, a2uiJsonl: null, a2uiBlueprint: null, compiledArtifact: null, compileNotices: [], enrichStatus: "idle" as const } : {}),
      steps: { ...state.steps, [name]: { ...state.steps[name], status: "loading", error: null, logs: [] } },
    }));

    try {
      const ensuredProfile = await get().ensureProfileDigest();
      if (name === "intent_analysis" && !ensuredProfile) {
        set((current) => ({ steps: { ...current.steps, [name]: { ...current.steps[name], status: "error", error: get().profileError ?? "通用画像尚未就绪" } } }));
        return;
      }
      const state = get();
      const freshPrefetch = state.prefetchedSearch && Date.now() - state.prefetchedSearch.fetchedAt <= 10 * 60 * 1000
        ? { searchQuery: state.prefetchedSearch.searchQuery, webSearchRaw: state.prefetchedSearch.webSearchRaw }
        : undefined;
      const response = await fetch("/api/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query, deviceContext, step: name,
          modelProfile: state.stepModels[name],
          ...(name === "intent_analysis" ? { profileDigest: ensuredProfile } : {}),
          inferenceState: state.inferenceState,
          ...(name === "context_enrichment" || name === "card_plan_generate" ? { userAnswers: state.answers } : {}),
          ...(name === "context_enrichment" && freshPrefetch ? { prefetchedSearch: freshPrefetch } : {}),
          ...(name === "a2ui_generate" ? { cardPlan: state.cardPlan } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        set((current) => ({ steps: { ...current.steps, [name]: { ...current.steps[name], status: "error", error: data.error ?? "推理失败", logs: data._logs ?? [] } } }));
        return;
      }

      set((current) => ({
        isMock: !!data._mock,
        inferenceState: data.inferenceState ?? current.inferenceState,
        slots: data.slots ?? current.slots,
        conflicts: data.conflicts ?? current.conflicts,
        questions: data.questions ?? current.questions,
        result: data.result ?? current.result,
        cardPlan: data.cardPlan ?? current.cardPlan,
        semanticMarkdown: data.semanticMarkdown ?? current.semanticMarkdown,
        reasoningGraph: data.reasoningGraph ?? current.reasoningGraph,
        a2uiJsonl: data.a2uiJsonl ?? current.a2uiJsonl,
        a2uiBlueprint: data.a2uiBlueprint ?? current.a2uiBlueprint,
        ...(name === "clarification" ? { answers: {} } : {}),
        ...(name === "card_plan_generate" && data.cardPlan ? { enrichStatus: "scanning" as const } : {}),
        steps: {
          ...current.steps,
          [name]: {
            status: "done", reasoning: data.reasoning ?? "", outputs: data.outputs ?? {},
            durationMs: data.durationMs ?? data.timing?.totalMs ?? 0,
            timing: data.timing, model: data.model, modelProfile: data.modelProfile, tokens: data.usage,
            cost: data.cost, error: null, logs: data._logs ?? [],
          },
        },
      }));

      if (name === "card_plan_generate" && data.cardPlan) await get().enrichAndCompile();
    } catch (error) {
      set((current) => ({ steps: { ...current.steps, [name]: { ...current.steps[name], status: "error", error: error instanceof Error ? error.message : "网络错误" } } }));
    }
  },

  runAll: async () => {
    set({ runAllPaused: false });
    await get().runStep("intent_analysis");
    if (get().steps.intent_analysis.status === "error") return;
    await get().runStep("evidence_resolution");
    if (get().steps.evidence_resolution.status === "error") return;
    await get().runStep("clarification");
    if (get().steps.clarification.status === "error") return;
    const { questions, answers } = get();
    if (questions.some((_, index) => !answers[index])) {
      set({ runAllPaused: true });
      void get().prefetchSearch();
      return;
    }
    await get().runStep("context_enrichment");
    if (get().steps.context_enrichment.status === "error") return;
    await get().runStep("card_plan_generate");
    if (get().steps.card_plan_generate.status === "error") return;
    await get().runStep("a2ui_generate");
  },

  continueGenerate: async () => {
    set({ runAllPaused: false });
    await get().runStep("context_enrichment");
    if (get().steps.context_enrichment.status === "error") return;
    await get().runStep("card_plan_generate");
    if (get().steps.card_plan_generate.status !== "error") await get().runStep("a2ui_generate");
  },

  reset: () => set({ query: DEFAULT_QUERY, deviceContext: presets[0], contextText: pretty(presets[0].records), steps: emptySteps(), stepModels: defaultStepModels(), isMock: false, profileStatus: "idle", profileDigest: null, profileError: null, profileContextText: null, ...clearedResult() }),
}));
