"use client";

import { create } from "zustand";
import { presets, DEFAULT_QUERY, type DeviceContext } from "@/lib/presets";
import type { InferSlot, InferConflict, InferQuestion, InferResult } from "@/lib/schemas";
import { PIPELINE_STEPS, type InferenceState, type ModelProfile, type PipelineStepName, type StepTiming, type TokenUsage } from "@/lib/pipelineTypes";
import type { CardPlan } from "@/dsl/modules";
import type { ProfileDigest } from "@/lib/profileTypes";
import type { ResultView } from "@/lib/resultViews";

export { RESULT_VIEWS, type ResultView } from "@/lib/resultViews";

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
  streamingChars: number;
  error: string | null;
  logs: StepLog[];
}

export interface OpenUIStreamMetrics {
  requestStartedAt?: number;
  responseHeadersAt?: number;
  bootstrapReceivedAt?: number;
  firstDeltaAt?: number;
  firstRenderableRootAt?: number;
  doneAt?: number;
}

interface SearchPrefetch {
  searchQuery: string;
  webSearchRaw: unknown;
  fetchedAt: number;
}

interface InferApiResponse {
  error?: string;
  _mock?: boolean;
  _logs?: StepLog[];
  reasoning?: string;
  outputs?: Record<string, unknown>;
  inferenceState?: InferenceState;
  slots?: InferSlot[];
  conflicts?: InferConflict[];
  questions?: InferQuestion[];
  result?: InferResult;
  cardPlan?: CardPlan;
  cardPlanMarkdown?: string;
  reasoningGraph?: string;
  openuiCode?: string;
  openuiDiagnostics?: {
    coverage: { required: number; matched: number; missing: string[] };
    parser: { statements: number; unresolved: string[]; orphaned: string[]; incomplete: boolean };
    repaired: boolean;
    repairTriggered: boolean;
    repairMs?: number;
  };
  durationMs?: number;
  timing?: StepTiming;
  model?: string;
  modelProfile?: ModelProfile;
  usage?: TokenUsage;
  cost?: number;
}

interface RunStepOptions {
  useCache?: boolean;
}

export const STEP_ORDER = PIPELINE_STEPS;
export type StepName = PipelineStepName;

export const STEP_LABEL: Record<StepName, string> = {
  intent_analysis: "① 意图建模",
  evidence_resolution: "② 证据解析",
  clarification: "③ 不确定性提问",
  context_enrichment: "④ 总结与能力补齐",
  card_plan_generate: "⑤ CardPlan 生成",
  openui_generate: "⑥ OpenUI 生成",
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
  cardPlanMarkdown: string | null;
  reasoningGraph: string | null;
  openuiCode: string | null;
  openuiDiagnostics: InferApiResponse["openuiDiagnostics"] | null;
  openuiStreamMetrics: OpenUIStreamMetrics;
  rightView: ResultView | null;
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
  setRightView: (view: ResultView) => void;
  markOpenUIFirstRenderableRoot: (timestamp?: number) => void;
  ensureProfileDigest: () => Promise<ProfileDigest | null>;
  prefetchSearch: () => Promise<void>;
  continueGenerate: () => Promise<void>;
  runStep: (name: StepName, options?: RunStepOptions) => Promise<void>;
  runAll: () => Promise<void>;
  reset: () => void;
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function emptyStep(): StepState {
  return { status: "pending", reasoning: "", outputs: {}, durationMs: 0, streamingChars: 0, error: null, logs: [] };
}

function emptySteps(): Record<StepName, StepState> {
  return {
    intent_analysis: emptyStep(),
    evidence_resolution: emptyStep(),
    clarification: emptyStep(),
    context_enrichment: emptyStep(),
    card_plan_generate: emptyStep(),
    openui_generate: emptyStep(),
  };
}

function defaultStepModels(): Record<StepName, ModelProfile> {
  return {
    intent_analysis: "groq_qwen_3_6_27b",
    evidence_resolution: "groq_qwen_3_6_27b",
    clarification: "groq_qwen_3_6_27b",
    context_enrichment: "groq_qwen_3_6_27b",
    card_plan_generate: "groq_qwen_3_6_27b",
    openui_generate: "groq_qwen_3_6_27b",
  };
}

function clearedResult() {
  return {
    inferenceState: null,
    slots: [] as InferSlot[], conflicts: [] as InferConflict[], questions: [] as InferQuestion[],
    result: null, cardPlan: null, cardPlanMarkdown: null, reasoningGraph: null, openuiCode: null, openuiDiagnostics: null, openuiStreamMetrics: {} as OpenUIStreamMetrics, rightView: null as ResultView | null,
    answers: {}, runAllPaused: false,
    prefetchedSearch: null as SearchPrefetch | null, prefetchStatus: "idle" as const,
  };
}

let pendingProfileRequest: Promise<ProfileDigest | null> | null = null;
const STEP_CACHE_LIMIT = 20;
const stepCache = new Map<string, InferApiResponse>();

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  if (value === undefined) return "undefined";
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

function cacheGet(key: string): InferApiResponse | undefined {
  const value = stepCache.get(key);
  if (!value) return undefined;
  stepCache.delete(key);
  stepCache.set(key, value);
  return value;
}

function cacheSet(key: string, value: InferApiResponse) {
  stepCache.delete(key);
  stepCache.set(key, value);
  while (stepCache.size > STEP_CACHE_LIMIT) {
    const oldest = stepCache.keys().next().value;
    if (typeof oldest !== "string") break;
    stepCache.delete(oldest);
  }
}

async function readInferResponse(
  response: Response,
  onDelta: (delta: string, chars: number) => void,
  onEvent?: (event: string) => void,
): Promise<InferApiResponse> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return response.json() as Promise<InferApiResponse>;
  }
  if (!response.body) throw new Error("流式响应缺少 body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload: InferApiResponse | undefined;
  const consumeFrame = (frame: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const payload = JSON.parse(dataLines.join("\n")) as InferApiResponse & { delta?: string; chars?: number };
    onEvent?.(event);
    if (event === "delta" && typeof payload.delta === "string" && typeof payload.chars === "number") onDelta(payload.delta, payload.chars);
    if (event === "done") donePayload = payload;
    if (event === "error") donePayload = payload;
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    frames.forEach(consumeFrame);
    if (done) break;
  }
  if (buffer.trim()) consumeFrame(buffer);
  if (!donePayload) throw new Error("流式响应未收到 done 事件");
  return donePayload;
}

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
  setContextText: (contextText) => {
    stepCache.clear();
    set({ contextText, profileStatus: "idle", profileDigest: null, profileError: null, profileContextText: null, steps: emptySteps(), ...clearedResult() });
  },
  setCustomContextText: (text) => set({ customContextText: text }),
  answerQuestion: (index, value) => set((state) => ({ answers: { ...state.answers, [index]: value } })),
  setStepModel: (name, profile) => set((state) => ({
    stepModels: { ...state.stepModels, [name]: profile },
    steps: { ...state.steps, [name]: emptyStep() },
  })),
  setRightView: (rightView) => set({ rightView }),
  markOpenUIFirstRenderableRoot: (timestamp = performance.now()) => set((state) => {
    if (!state.openuiStreamMetrics.requestStartedAt || state.openuiStreamMetrics.firstRenderableRootAt !== undefined) return {};
    return {
      openuiStreamMetrics: {
        ...state.openuiStreamMetrics,
        firstRenderableRootAt: timestamp,
      },
    };
  }),

  selectPreset: (id) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    stepCache.clear();
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

  runStep: async (name, options = {}) => {
    const { query, contextText } = get();
    let deviceContext: Record<string, unknown>;
    try {
      deviceContext = JSON.parse(contextText);
    } catch {
      set((state) => ({ steps: { ...state.steps, [name]: { ...state.steps[name], status: "error", error: "设备上下文不是合法 JSON" } } }));
      return;
    }

    set((state) => ({
      ...(name === "card_plan_generate" ? { result: null, cardPlan: null, cardPlanMarkdown: null, reasoningGraph: null, openuiCode: null, openuiDiagnostics: null, rightView: "cardplan-markdown" as const } : {}),
      ...(name === "openui_generate" ? { openuiCode: null, openuiDiagnostics: null, openuiStreamMetrics: {}, rightView: "openui" as const } : {}),
      steps: { ...state.steps, [name]: { ...state.steps[name], status: "loading", streamingChars: 0, error: null, logs: [] } },
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
      const requestBody = {
        query, deviceContext, step: name,
        modelProfile: state.stepModels[name],
        ...(name === "intent_analysis" ? { profileDigest: ensuredProfile } : {}),
        ...(name !== "intent_analysis" && name !== "openui_generate" ? { inferenceState: state.inferenceState } : {}),
        ...(name === "context_enrichment" || name === "card_plan_generate" ? { userAnswers: state.answers } : {}),
        ...(name === "context_enrichment" && freshPrefetch ? { prefetchedSearch: freshPrefetch } : {}),
        ...(name === "openui_generate" ? { cardPlan: state.cardPlan, stream: true } : {}),
      };
      const cacheKey = `${name}|${state.stepModels[name]}|${stableStringify(requestBody)}`;
      const cached = options.useCache ? cacheGet(cacheKey) : undefined;
      let data: InferApiResponse;
      let responseOk = true;
      if (cached) {
        data = {
          ...cached,
          _logs: [
            ...(cached._logs ?? []),
            { ts: new Date().toISOString(), phase: "response", message: "命中前端步骤缓存" },
          ],
        };
      } else {
        if (name === "openui_generate") {
          set({ openuiStreamMetrics: { requestStartedAt: performance.now() } });
        }
        const response = await fetch("/api/infer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        responseOk = response.ok;
        if (name === "openui_generate") {
          set((current) => ({
            openuiStreamMetrics: {
              ...current.openuiStreamMetrics,
              responseHeadersAt: performance.now(),
            },
          }));
        }
        data = await readInferResponse(response, (delta, streamingChars) => set((current) => ({
          openuiCode: name === "openui_generate" ? `${current.openuiCode ?? ""}${delta}` : current.openuiCode,
          ...(name === "openui_generate"
            ? {
                openuiStreamMetrics: {
                  ...current.openuiStreamMetrics,
                  firstDeltaAt: current.openuiStreamMetrics.firstDeltaAt ?? performance.now(),
                },
              }
            : {}),
          steps: {
            ...current.steps,
            [name]: { ...current.steps[name], streamingChars },
          },
        })), (event) => {
          if (name !== "openui_generate") return;
          if (event === "bootstrap") {
            set((current) => ({
              openuiStreamMetrics: {
                ...current.openuiStreamMetrics,
                bootstrapReceivedAt: current.openuiStreamMetrics.bootstrapReceivedAt ?? performance.now(),
              },
            }));
          }
          if (event === "done" || event === "error") {
            set((current) => ({
              openuiStreamMetrics: {
                ...current.openuiStreamMetrics,
                doneAt: current.openuiStreamMetrics.doneAt ?? performance.now(),
              },
            }));
          }
        });
        if (responseOk && !data.error && options.useCache) cacheSet(cacheKey, data);
      }
      if (!responseOk || data.error) {
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
        cardPlanMarkdown: data.cardPlanMarkdown ?? current.cardPlanMarkdown,
        reasoningGraph: data.reasoningGraph ?? current.reasoningGraph,
        openuiCode: data.openuiCode ?? current.openuiCode,
        openuiDiagnostics: data.openuiDiagnostics ?? current.openuiDiagnostics,
        ...(name === "clarification" ? { answers: {} } : {}),
        steps: {
          ...current.steps,
          [name]: {
            status: "done", reasoning: data.reasoning ?? "", outputs: data.outputs ?? {},
            durationMs: data.durationMs ?? data.timing?.totalMs ?? 0,
            timing: data.timing, model: data.model, modelProfile: data.modelProfile, tokens: data.usage,
            cost: data.cost, streamingChars: 0, error: null, logs: data._logs ?? [],
          },
        },
      }));

    } catch (error) {
      set((current) => ({ steps: { ...current.steps, [name]: { ...current.steps[name], status: "error", error: error instanceof Error ? error.message : "网络错误" } } }));
    }
  },

  runAll: async () => {
    set({ runAllPaused: false });
    await get().runStep("intent_analysis", { useCache: true });
    if (get().steps.intent_analysis.status === "error") return;
    await get().runStep("evidence_resolution", { useCache: true });
    if (get().steps.evidence_resolution.status === "error") return;
    await get().runStep("clarification", { useCache: true });
    if (get().steps.clarification.status === "error") return;
    const { questions, answers } = get();
    if (questions.some((_, index) => !answers[index])) {
      set({ runAllPaused: true });
      void get().prefetchSearch();
      return;
    }
    await get().runStep("context_enrichment", { useCache: true });
    if (get().steps.context_enrichment.status === "error") return;
    await get().runStep("card_plan_generate", { useCache: true });
    if (get().steps.card_plan_generate.status === "error") return;
    await get().runStep("openui_generate", { useCache: true });
  },

  continueGenerate: async () => {
    set({ runAllPaused: false });
    await get().runStep("context_enrichment", { useCache: true });
    if (get().steps.context_enrichment.status === "error") return;
    await get().runStep("card_plan_generate", { useCache: true });
    if (get().steps.card_plan_generate.status !== "error") await get().runStep("openui_generate", { useCache: true });
  },

  reset: () => {
    stepCache.clear();
    set({ query: DEFAULT_QUERY, deviceContext: presets[0], contextText: pretty(presets[0].records), steps: emptySteps(), stepModels: defaultStepModels(), isMock: false, profileStatus: "idle", profileDigest: null, profileError: null, profileContextText: null, ...clearedResult() });
  },
}));
