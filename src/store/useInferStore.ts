"use client";

import { create } from "zustand";
import { presets, DEFAULT_QUERY, type DeviceContext } from "@/lib/presets";
import type { InferSlot, InferConflict, InferQuestion, InferResult } from "@/lib/schemas";
import { PIPELINE_STEPS, type InferenceState, type ModelProfile, type PipelineStepName, type PipelineStepOutput, type StepTiming, type TokenUsage } from "@/lib/pipelineTypes";
import type { CardPlan } from "@/dsl/modules";
import type { ProfileDigest } from "@/lib/profileTypes";
import type { ResultView } from "@/lib/resultViews";
import { classifyQuery, refineClassification } from "@/lib/adaptive/classification";
import { resolveEffectivePolicy } from "@/lib/adaptive/policy";
import type { AdaptivePolicyEntry, QueryClassification } from "@/lib/adaptive/types";
import type { StepProvenance } from "@/lib/provenance";
import type { CardEditModelProfile, CardEditTarget, OpenUIEditVersion } from "@/lib/cardEditingTypes";
import type { GenerationEpisode, LearningSettings, PolicyObservation } from "@/learning/types";
import { abandonEpisode, appendEpisodeEdit, createGenerationEpisode, finalizeEpisode, recordEpisodeStep, recordEpisodeUndo, recordInitialOpenUI } from "@/learning/episode";
import { exportLearningData, getLearningSettings, listEpisodes, listPolicies, listPolicyObservations, putEpisode, putLearningSettings, putPolicy, putPolicyObservation } from "@/learning/storage";
import type { AttributionReport, PolicyGradientCandidate } from "@/lib/reflection/types";
import { canGuardedAutoPromote, observationFromCandidate, promoteCandidate, reflectionPolicyForEpisode, rollbackPolicy } from "@/lib/reflection/promotion";
import { validateGradientCandidate } from "@/lib/reflection/gradient";
import { FEATURE_FLAGS } from "@/lib/featureFlags";

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
  adaptive?: PipelineStepOutput["adaptive"];
  provenance?: StepProvenance;
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
  adaptive?: PipelineStepOutput["adaptive"];
  provenance?: StepProvenance;
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
  queryClassification: QueryClassification;
  stablePolicies: AdaptivePolicyEntry[];
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
  isTargeting: boolean;
  cardEditTarget: CardEditTarget | null;
  editDraft: string;
  cardEditModelProfile: CardEditModelProfile;
  editStatus: "idle" | "streaming" | "error" | "done";
  editError: string | null;
  editStreamingPatch: string;
  openuiVersions: OpenUIEditVersion[];
  openuiVersionIndex: number;
  currentEpisode: GenerationEpisode | null;
  isReflectionOpen: boolean;
  reflectionStatus: "idle" | "attributing" | "generating-candidates" | "ready" | "error";
  attributionReport: AttributionReport | null;
  gradientCandidates: PolicyGradientCandidate[];
  candidateDecisions: Record<string, PolicyObservation["decision"]>;
  reflectionError: string | null;
  learningSettings: LearningSettings;
  setQuery: (query: string) => void;
  selectPreset: (id: string) => void;
  setContextText: (text: string) => void;
  setCustomContextText: (text: string) => void;
  answerQuestion: (index: number, value: string) => void;
  setStepModel: (name: StepName, profile: ModelProfile) => void;
  setRightView: (view: ResultView) => void;
  markOpenUIFirstRenderableRoot: (timestamp?: number) => void;
  initializeLearning: () => Promise<void>;
  setTargeting: (active: boolean) => void;
  setCardEditTarget: (target: CardEditTarget | null) => void;
  setEditDraft: (value: string) => void;
  setCardEditModelProfile: (profile: CardEditModelProfile) => void;
  submitCardEdit: () => Promise<void>;
  undoOpenUIEdit: () => void;
  redoOpenUIEdit: () => void;
  acceptCurrentEpisode: () => Promise<void>;
  runReflection: (episode?: GenerationEpisode) => Promise<void>;
  applyPolicyCandidate: (candidateId: string, automatic?: boolean) => Promise<void>;
  discardPolicyCandidate: (candidateId: string) => Promise<void>;
  setLearningMode: (mode: LearningSettings["learningMode"]) => Promise<void>;
  rollbackAdaptivePolicy: (policyId: string) => Promise<void>;
  closeReflection: () => void;
  exportLearningJson: () => Promise<void>;
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
    isTargeting: false, cardEditTarget: null as CardEditTarget | null, editDraft: "", editStatus: "idle" as const,
    editError: null as string | null, editStreamingPatch: "", openuiVersions: [] as OpenUIEditVersion[], openuiVersionIndex: -1,
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

interface EditApiResponse {
  error?: string;
  patch?: string;
  code?: string;
  beforeSlice?: string;
  afterSlice?: string;
  model?: string;
  metrics?: OpenUIEditVersion["metrics"];
}

async function readEditResponse(response: Response, onDelta: (delta: string) => void): Promise<EditApiResponse> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return response.json() as Promise<EditApiResponse>;
  if (!response.body) throw new Error("编辑流式响应缺少 body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: EditApiResponse | undefined;
  const consume = (frame: string) => {
    let event = "message";
    const lines: string[] = [];
    frame.split(/\r?\n/).forEach((line) => {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
    });
    if (!lines.length) return;
    const payload = JSON.parse(lines.join("\n")) as EditApiResponse & { delta?: string };
    if (event === "delta" && typeof payload.delta === "string") onDelta(payload.delta);
    if (event === "done" || event === "error") terminal = payload;
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    frames.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!terminal) throw new Error("编辑流未收到终止事件");
  return terminal;
}

function persistAbandoned(episode: GenerationEpisode | null) {
  if (!episode || episode.status === "accepted" || episode.status === "abandoned") return;
  void putEpisode(abandonEpisode(episode)).catch(() => undefined);
}

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const useInferStore = create<InferState>((set, get) => ({
  query: DEFAULT_QUERY,
  queryClassification: FEATURE_FLAGS.ADAPTIVE_QUERY_CLASSIFICATION ? classifyQuery(DEFAULT_QUERY) : { taskFamily: "general", decisionMode: "general", confidence: 1, source: "heuristic" },
  stablePolicies: [],
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
  cardEditModelProfile: "glm_5_2",
  currentEpisode: null,
  isReflectionOpen: false,
  reflectionStatus: "idle",
  attributionReport: null,
  gradientCandidates: [],
  candidateDecisions: {},
  reflectionError: null,
  learningSettings: { id: "settings", enabled: true, learningMode: "manual", updatedAt: new Date(0).toISOString() },
  ...clearedResult(),

  setQuery: (query) => {
    persistAbandoned(get().currentEpisode);
    set({ query, queryClassification: FEATURE_FLAGS.ADAPTIVE_QUERY_CLASSIFICATION ? classifyQuery(query) : { taskFamily: "general", decisionMode: "general", confidence: 1, source: "heuristic" }, prefetchedSearch: null, prefetchStatus: "idle", currentEpisode: null, isReflectionOpen: false });
  },
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
  initializeLearning: async () => {
    try {
      const [stablePolicies, learningSettings] = await Promise.all([listPolicies(), getLearningSettings()]);
      set({ stablePolicies, learningSettings });
    }
    catch { set({ stablePolicies: [] }); }
  },
  setTargeting: (isTargeting) => set({ isTargeting, ...(isTargeting ? { cardEditTarget: null, editError: null } : {}) }),
  setCardEditTarget: (cardEditTarget) => set({ cardEditTarget, isTargeting: false, editError: null }),
  setEditDraft: (editDraft) => set({ editDraft }),
  setCardEditModelProfile: (cardEditModelProfile) => set({ cardEditModelProfile }),
  undoOpenUIEdit: () => set((state) => {
    const nextIndex = Math.max(0, state.openuiVersionIndex - 1);
    if (nextIndex === state.openuiVersionIndex || !state.openuiVersions[nextIndex]) return {};
    return { openuiVersionIndex: nextIndex, openuiCode: state.openuiVersions[nextIndex].code, editStatus: "idle", editError: null, currentEpisode: state.currentEpisode ? recordEpisodeUndo(state.currentEpisode) : null };
  }),
  redoOpenUIEdit: () => set((state) => {
    const nextIndex = Math.min(state.openuiVersions.length - 1, state.openuiVersionIndex + 1);
    if (nextIndex === state.openuiVersionIndex || !state.openuiVersions[nextIndex]) return {};
    return { openuiVersionIndex: nextIndex, openuiCode: state.openuiVersions[nextIndex].code, editStatus: "idle", editError: null };
  }),
  submitCardEdit: async () => {
    if (!FEATURE_FLAGS.OPENUI_CARD_EDIT) return;
    const state = get();
    if (!state.openuiCode || !state.cardPlan || !state.cardPlanMarkdown || !state.cardEditTarget || !state.editDraft.trim()) {
      set({ editStatus: "error", editError: "请先点选卡片位置并填写编辑要求" });
      return;
    }
    const requestSnapshot = {
      currentCode: state.openuiCode,
      cardPlan: state.cardPlan,
      cardPlanMarkdown: state.cardPlanMarkdown,
      cardId: state.cardEditTarget.cardId,
      target: state.cardEditTarget,
      instruction: state.editDraft.trim(),
      modelProfile: state.cardEditModelProfile,
    };
    set({ editStatus: "streaming", editError: null, editStreamingPatch: "" });
    try {
      const response = await fetch("/api/openui/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestSnapshot),
      });
      const data = await readEditResponse(response, (delta) => set((current) => ({ editStreamingPatch: `${current.editStreamingPatch}${delta}` })));
      if (!response.ok || data.error || !data.code || data.beforeSlice === undefined || data.afterSlice === undefined) {
        throw new Error(data.error ?? "编辑结果不完整");
      }
      const version: OpenUIEditVersion = {
        id: `edit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        code: data.code,
        instruction: requestSnapshot.instruction,
        target: requestSnapshot.target,
        modelProfile: requestSnapshot.modelProfile,
        beforeSlice: data.beforeSlice,
        afterSlice: data.afterSlice,
        metrics: data.metrics,
      };
      set((current) => {
        const branch = current.openuiVersions.slice(0, current.openuiVersionIndex + 1);
        const versions = [...branch, version];
        return {
          openuiCode: data.code,
          openuiVersions: versions,
          openuiVersionIndex: versions.length - 1,
          editStatus: "done",
          editError: null,
          editStreamingPatch: data.patch ?? current.editStreamingPatch,
          editDraft: "",
          currentEpisode: current.currentEpisode ? appendEpisodeEdit(current.currentEpisode, version) : null,
        };
      });
    } catch (error) {
      set({ editStatus: "error", editError: error instanceof Error ? error.message : "卡片编辑失败" });
    }
  },
  acceptCurrentEpisode: async () => {
    const state = get();
    if (!state.currentEpisode || !state.openuiCode) return;
    const episode = finalizeEpisode(state.currentEpisode, state.openuiCode);
    try {
      await putEpisode(episode);
    } catch (error) {
      set({ currentEpisode: episode, isReflectionOpen: true, reflectionStatus: "error", reflectionError: `最终 UI 已保留，但 Episode 持久化失败：${error instanceof Error ? error.message : "IndexedDB 不可用"}` });
      return;
    }
    if (!FEATURE_FLAGS.REFLECTION_ATTRIBUTION || !state.learningSettings.enabled) {
      set({ currentEpisode: episode, isReflectionOpen: false, reflectionStatus: "idle" });
      return;
    }
    set({ currentEpisode: episode, isReflectionOpen: true, reflectionStatus: "attributing", attributionReport: null, gradientCandidates: [], candidateDecisions: {}, reflectionError: null });
    void get().runReflection(episode);
  },
  runReflection: async (episodeInput) => {
    if (!FEATURE_FLAGS.REFLECTION_ATTRIBUTION) return;
    const episode = episodeInput ?? get().currentEpisode;
    if (!episode || episode.status !== "accepted") return;
    set({ isReflectionOpen: true, reflectionStatus: "attributing", reflectionError: null, attributionReport: null, gradientCandidates: [], candidateDecisions: {} });
    try {
      const attributeResponse = await fetch("/api/reflection/attribute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episode }),
      });
      const attributeData = await attributeResponse.json() as { report?: AttributionReport; error?: string };
      if (!attributeResponse.ok || !attributeData.report) throw new Error(attributeData.error ?? "阶段归因失败");
      const report = attributeData.report;
      set({ attributionReport: report });
      if (!FEATURE_FLAGS.REFLECTION_GRADIENT || Math.max(...Object.values(report.distribution)) < 0.35 || report.reasonCodes.includes("accepted_without_edits")) {
        set({ reflectionStatus: "ready", gradientCandidates: [] });
        return;
      }
      set({ reflectionStatus: "generating-candidates" });
      const currentPolicy = reflectionPolicyForEpisode(episode, get().stablePolicies);
      let candidates: PolicyGradientCandidate[] = [];
      try {
        const gradientResponse = await fetch("/api/reflection/gradient", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ episode, attribution: report, currentPolicy }),
        });
        const gradientData = await gradientResponse.json() as { candidates?: PolicyGradientCandidate[]; error?: string };
        if (!gradientResponse.ok) throw new Error(gradientData.error ?? "策略候选生成失败");
        candidates = gradientData.candidates ?? [];
      } catch (error) {
        set({ reflectionStatus: "ready", gradientCandidates: [], reflectionError: `阶段归因已完成，但没有生成可安全复用的策略候选：${error instanceof Error ? error.message : "候选生成失败"}` });
        return;
      }
      const observations = candidates.map((candidate) => observationFromCandidate(episode, candidate));
      await Promise.all(observations.map(putPolicyObservation));
      set({ gradientCandidates: candidates, candidateDecisions: Object.fromEntries(candidates.map((candidate) => [candidate.id, "pending"])), reflectionStatus: "ready" });

      if (FEATURE_FLAGS.GUARDED_AUTO_LEARN && get().learningSettings.learningMode === "guarded-auto" && candidates.length) {
        const [storedObservations, acceptedEpisodes] = await Promise.all([listPolicyObservations(), listEpisodes()]);
        for (const candidate of candidates) {
          if (canGuardedAutoPromote({ candidate, observations: storedObservations, settings: get().learningSettings, acceptedEpisodes })) await get().applyPolicyCandidate(candidate.id, true);
        }
      }
    } catch (error) {
      set({ reflectionStatus: "error", reflectionError: error instanceof Error ? error.message : "本次反思失败" });
    }
  },
  applyPolicyCandidate: async (candidateId, automatic = false) => {
    const state = get();
    const candidate = state.gradientCandidates.find((item) => item.id === candidateId);
    const episode = state.currentEpisode;
    if (!candidate || !episode || state.candidateDecisions[candidateId] !== "pending") return;
    const validation = validateGradientCandidate(candidate, episode);
    if (!validation.valid || !validation.candidate) {
      set({ reflectionError: validation.reason ?? "候选未通过 trust-region 校验" });
      return;
    }
    const policy = promoteCandidate(validation.candidate, state.stablePolicies);
    const observation = { ...observationFromCandidate(episode, validation.candidate), decision: automatic ? "auto-applied" as const : "applied" as const, policyId: policy.id };
    await Promise.all([putPolicy(policy), putPolicyObservation(observation)]);
    set((current) => ({ stablePolicies: [...current.stablePolicies, policy], candidateDecisions: { ...current.candidateDecisions, [candidateId]: observation.decision }, reflectionError: null }));
  },
  discardPolicyCandidate: async (candidateId) => {
    const state = get();
    const candidate = state.gradientCandidates.find((item) => item.id === candidateId);
    const episode = state.currentEpisode;
    if (!candidate || !episode || state.candidateDecisions[candidateId] !== "pending") return;
    const observation = { ...observationFromCandidate(episode, candidate), decision: "discarded" as const };
    await putPolicyObservation(observation);
    set((current) => ({ candidateDecisions: { ...current.candidateDecisions, [candidateId]: "discarded" } }));
  },
  setLearningMode: async (learningMode) => {
    if (learningMode === "guarded-auto" && !FEATURE_FLAGS.GUARDED_AUTO_LEARN) return;
    const settings: LearningSettings = { id: "settings", enabled: true, learningMode, updatedAt: new Date().toISOString() };
    await putLearningSettings(settings);
    set({ learningSettings: settings });
  },
  rollbackAdaptivePolicy: async (policyId) => {
    const state = get();
    const target = state.stablePolicies.find((policy) => policy.id === policyId);
    if (!target) return;
    const restored = rollbackPolicy(target, state.stablePolicies);
    await putPolicy(restored);
    set((current) => ({ stablePolicies: [...current.stablePolicies, restored] }));
  },
  closeReflection: () => set({ isReflectionOpen: false }),
  exportLearningJson: async () => downloadJson(await exportLearningData(), `cot-genui-learning-${new Date().toISOString().slice(0, 10)}.json`),
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
    if (name === "intent_analysis" && !get().currentEpisode) {
      set({ currentEpisode: createGenerationEpisode({ query, classification: get().queryClassification }), isReflectionOpen: false });
    }
    let deviceContext: Record<string, unknown>;
    try {
      deviceContext = JSON.parse(contextText);
    } catch {
      set((state) => ({ steps: { ...state.steps, [name]: { ...state.steps[name], status: "error", error: "设备上下文不是合法 JSON" } } }));
      return;
    }

    set((state) => ({
      ...(name === "card_plan_generate" ? { result: null, cardPlan: null, cardPlanMarkdown: null, reasoningGraph: null, openuiCode: null, openuiDiagnostics: null, openuiVersions: [], openuiVersionIndex: -1, rightView: "cardplan-markdown" as const } : {}),
      ...(name === "openui_generate" ? { openuiCode: null, openuiDiagnostics: null, openuiStreamMetrics: {}, openuiVersions: [], openuiVersionIndex: -1, cardEditTarget: null, rightView: "openui" as const } : {}),
      steps: { ...state.steps, [name]: { ...state.steps[name], status: "loading", streamingChars: 0, error: null, logs: [] } },
    }));

    try {
      const ensuredProfile = await get().ensureProfileDigest();
      if (name === "intent_analysis" && !ensuredProfile) {
        set((current) => ({ steps: { ...current.steps, [name]: { ...current.steps[name], status: "error", error: get().profileError ?? "通用画像尚未就绪" } } }));
        return;
      }
      const state = get();
      const adaptiveContext = FEATURE_FLAGS.ADAPTIVE_STEERING ? resolveEffectivePolicy({
        classification: state.queryClassification,
        userKey: ensuredProfile?.contextHash,
        stablePolicies: state.stablePolicies,
        step: name,
      }) : undefined;
      const freshPrefetch = state.prefetchedSearch && Date.now() - state.prefetchedSearch.fetchedAt <= 10 * 60 * 1000
        ? { searchQuery: state.prefetchedSearch.searchQuery, webSearchRaw: state.prefetchedSearch.webSearchRaw }
        : undefined;
      const requestBody = {
        query, deviceContext, step: name,
        modelProfile: state.stepModels[name],
        ...(FEATURE_FLAGS.ADAPTIVE_QUERY_CLASSIFICATION ? { classification: state.queryClassification } : {}),
        ...(adaptiveContext ? { adaptiveContext } : {}),
        ...(name === "intent_analysis" ? { profileDigest: ensuredProfile } : {}),
        ...(name === "intent_analysis" && state.customContextText.trim().length > 20 ? { profileSourceText: state.customContextText.trim() } : {}),
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

      set((current) => {
        const nextClassification = FEATURE_FLAGS.ADAPTIVE_QUERY_CLASSIFICATION && name === "intent_analysis" && data.inferenceState
          ? refineClassification(current.queryClassification, data.inferenceState)
          : current.queryClassification;
        const finalOpenUICode = data.openuiCode ?? current.openuiCode;
        let episode = current.currentEpisode ?? createGenerationEpisode({ query, classification: nextClassification, userKey: ensuredProfile?.contextHash });
        episode = { ...episode, queryClassification: nextClassification, userKey: episode.userKey ?? ensuredProfile?.contextHash };
        episode = recordEpisodeStep(episode, name, {
          modelProfile: data.modelProfile ?? current.stepModels[name],
          adaptive: data.adaptive,
          provenance: data.provenance,
          usage: data.usage,
        });
        if (name === "openui_generate" && finalOpenUICode) episode = recordInitialOpenUI(episode, finalOpenUICode, (data.cardPlan ?? current.cardPlan)?.cards.length ?? 0);
        const initialVersion: OpenUIEditVersion | null = name === "openui_generate" && finalOpenUICode ? {
          id: "v0",
          createdAt: new Date().toISOString(),
          code: finalOpenUICode,
        } : null;
        return {
        isMock: !!data._mock,
        queryClassification: nextClassification,
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
        currentEpisode: episode,
        ...(initialVersion ? { openuiVersions: [initialVersion], openuiVersionIndex: 0 } : {}),
        ...(name === "clarification" ? { answers: {} } : {}),
        steps: {
          ...current.steps,
          [name]: {
            status: "done", reasoning: data.reasoning ?? "", outputs: data.outputs ?? {},
            durationMs: data.durationMs ?? data.timing?.totalMs ?? 0,
            timing: data.timing, model: data.model, modelProfile: data.modelProfile, tokens: data.usage,
            cost: data.cost, streamingChars: 0, error: null, logs: data._logs ?? [],
            adaptive: data.adaptive,
            provenance: data.provenance,
          },
        },
      };
      });

    } catch (error) {
      set((current) => ({ steps: { ...current.steps, [name]: { ...current.steps[name], status: "error", error: error instanceof Error ? error.message : "网络错误" } } }));
    }
  },

  runAll: async () => {
    persistAbandoned(get().currentEpisode);
    set({
      runAllPaused: false,
      currentEpisode: createGenerationEpisode({ query: get().query, classification: get().queryClassification, userKey: get().profileDigest?.contextHash }),
      isReflectionOpen: false,
    });
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
    persistAbandoned(get().currentEpisode);
    stepCache.clear();
    set({ query: DEFAULT_QUERY, queryClassification: FEATURE_FLAGS.ADAPTIVE_QUERY_CLASSIFICATION ? classifyQuery(DEFAULT_QUERY) : { taskFamily: "general", decisionMode: "general", confidence: 1, source: "heuristic" }, deviceContext: presets[0], contextText: pretty(presets[0].records), steps: emptySteps(), stepModels: defaultStepModels(), cardEditModelProfile: "glm_5_2", isMock: false, profileStatus: "idle", profileDigest: null, profileError: null, profileContextText: null, currentEpisode: null, isReflectionOpen: false, ...clearedResult() });
  },
}));
