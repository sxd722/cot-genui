"use client";

import { create } from "zustand";
import { presets, DEFAULT_QUERY, type DeviceContext } from "@/lib/presets";
import type { InferSlot, InferConflict, InferQuestion, InferResult } from "@/lib/schemas";
import { PIPELINE_STEPS, type InferenceState, type ModelProfile, type PipelineStepName, type PipelineStepOutput, type StepTiming, type TokenUsage } from "@/lib/pipelineTypes";
import type { CardLayoutMode, CardPlan } from "@/dsl/modules";
import type { ProfileDigest } from "@/lib/profileTypes";
import type { ResultView } from "@/lib/resultViews";
import { classifyQuery, refineClassification } from "@/lib/adaptive/classification";
import { resolveEffectivePolicy } from "@/lib/adaptive/policy";
import type { AdaptivePolicyEntry, QueryClassification } from "@/lib/adaptive/types";
import type { StepProvenance } from "@/lib/provenance";
import type { CardEditModelProfile, CardEditTarget, OpenUIEditVersion } from "@/lib/cardEditingTypes";
import type { GenerationEpisode, LearningSettings, PolicyObservation } from "@/learning/types";
import { abandonEpisode, appendEpisodeEdit, appendEpisodeFeedback, createGenerationEpisode, finalizeEpisode, recordEpisodeStep, recordEpisodeUndo, recordInitialOpenUI } from "@/learning/episode";
import { defaultSkillStepReuse, exportLearningData, getLearningSettings, listEpisodes, listPolicies, listPolicyObservations, listSkillCandidates, listSkills, listSkillVersions, putEpisode, putLearningSettings, putPolicy, putPolicyObservation } from "@/learning/storage";
import { abandonTaskRun, acceptTaskRunAndCreateCandidate, beginStepCapture, completeStepCapture, failStepCapture, failTaskRun, recordCardEdit, recordClarificationAnswers, startTaskRun, workflowRunId } from "@/learning/workflowCapture";
import type { AttributionReport, PolicyGradientCandidate } from "@/lib/reflection/types";
import { canGuardedAutoPromote, observationFromCandidate, promoteCandidate, reflectionPolicyForEpisode, rollbackPolicy } from "@/lib/reflection/promotion";
import { validateGradientCandidate } from "@/lib/reflection/gradient";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import type { AssetManifest } from "@/openui/assetTypes";
import { CARD_LAYOUT_STORAGE_KEY, DEFAULT_CARD_LAYOUT_MODE, isCardLayoutMode } from "@/openui/layoutPolicy";
import { emptyLayoutStabilization, type OpenUILayoutMeasurement, type OpenUILayoutRepairResponse, type OpenUILayoutStabilizationDiagnostics } from "@/openui/layoutRuntime";
import { stableTextHash } from "@/lib/provenance";
import { buildDeterministicFixedOpenUI } from "@/openui/fixedArtifact";
import { rankMatchableSkills, selectionFromMatch, SKILL_SUGGEST_THRESHOLD, type SkillMatchCandidate } from "@/learning/skillMatcher";
import { buildSkillStepContext } from "@/learning/skillRecipe";
import type { ExternalSkillMatcherModel, QueryAbstractionV1, SkillCandidateRecord, SkillInvocation, SkillMatchReport, SkillRecord, SkillRecipe, SkillReuseSelection, SkillVersionRecord } from "@/learning/workflowTypes";
import { autoPublishSkillCandidate } from "@/learning/skillPackage";
import { applyExternalSkillRanking, buildSkillInvocation, buildSkillMatchDecisionLogs, buildSkillMatchReport, EXTERNAL_SKILL_CANDIDATE_LIMIT, toExternalCandidateView, type ExternalSkillMatchWireResult } from "@/learning/externalSkillMatcher";

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
  skillReuse?: PipelineStepOutput["skillReuse"];
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
  openuiDiagnostics?: PipelineStepOutput["openuiDiagnostics"];
  assetManifest?: AssetManifest;
  durationMs?: number;
  timing?: StepTiming;
  model?: string;
  modelProfile?: ModelProfile;
  usage?: TokenUsage;
  cost?: number;
  adaptive?: PipelineStepOutput["adaptive"];
  provenance?: StepProvenance;
  skillReuse?: PipelineStepOutput["skillReuse"];
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
  layoutMode: CardLayoutMode;
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
  assetManifest: AssetManifest | null;
  openuiStreamMetrics: OpenUIStreamMetrics;
  layoutStabilization: OpenUILayoutStabilizationDiagnostics;
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
  overallFeedbackDraft: string;
  feedbackStatus: "idle" | "saving" | "saved" | "error";
  feedbackError: string | null;
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
  skillMatches: SkillMatchCandidate[];
  selectedSkill: SkillReuseSelection | null;
  selectedSkillRecipe: SkillRecipe | null;
  queryAbstraction: QueryAbstractionV1 | null;
  skillMatchReport: SkillMatchReport | null;
  selectedSkillInvocation: SkillInvocation | null;
  skillDecisionLocked: boolean;
  skills: SkillRecord[];
  skillVersions: SkillVersionRecord[];
  skillCandidates: SkillCandidateRecord[];
  isSkillCenterOpen: boolean;
  skillMatchStatus: "idle" | "matching" | "ready" | "fallback" | "error";
  skillMatchError: string | null;
  skillMatchDiagnostics: {
    abstractionModel?: string;
    abstractionDurationMs?: number;
    abstractionPromptTokens?: number;
    model?: string;
    durationMs?: number;
    promptTokens?: number;
    candidateCount: number;
    decisionLogs?: string[];
  } | null;
  setQuery: (query: string) => void;
  setLayoutMode: (mode: CardLayoutMode) => void;
  hydrateLayoutMode: () => void;
  selectPreset: (id: string) => void;
  setContextText: (text: string) => void;
  setCustomContextText: (text: string) => void;
  answerQuestion: (index: number, value: string) => void;
  setStepModel: (name: StepName, profile: ModelProfile) => void;
  setRightView: (view: ResultView) => void;
  markOpenUIFirstRenderableRoot: (timestamp?: number) => void;
  reportOpenUILayout: (measurements: OpenUILayoutMeasurement[]) => Promise<void>;
  initializeLearning: () => Promise<void>;
  setTargeting: (active: boolean) => void;
  setCardEditTarget: (target: CardEditTarget | null) => void;
  setEditDraft: (value: string) => void;
  setOverallFeedbackDraft: (value: string) => void;
  submitOverallFeedback: () => Promise<void>;
  setCardEditModelProfile: (profile: CardEditModelProfile) => void;
  submitCardEdit: () => Promise<void>;
  undoOpenUIEdit: () => void;
  redoOpenUIEdit: () => void;
  acceptCurrentEpisode: () => Promise<void>;
  runReflection: (episode?: GenerationEpisode) => Promise<void>;
  applyPolicyCandidate: (candidateId: string, automatic?: boolean) => Promise<void>;
  discardPolicyCandidate: (candidateId: string) => Promise<void>;
  setLearningMode: (mode: LearningSettings["learningMode"]) => Promise<void>;
  setSkillReuseEnabled: (enabled: boolean) => Promise<void>;
  setSkillStepReuse: (step: StepName, enabled: boolean) => Promise<void>;
  setSkillMatchModel: (model: ExternalSkillMatcherModel) => Promise<void>;
  prepareSkillReuse: () => Promise<void>;
  selectSkillMatch: (skillId: string | null) => void;
  refreshSkills: () => Promise<void>;
  setSkillCenterOpen: (open: boolean) => void;
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
    result: null, cardPlan: null, cardPlanMarkdown: null, reasoningGraph: null, openuiCode: null, openuiDiagnostics: null, assetManifest: null as AssetManifest | null, openuiStreamMetrics: {} as OpenUIStreamMetrics, layoutStabilization: emptyLayoutStabilization(), rightView: null as ResultView | null,
    answers: {}, runAllPaused: false,
    prefetchedSearch: null as SearchPrefetch | null, prefetchStatus: "idle" as const,
    isTargeting: false, cardEditTarget: null as CardEditTarget | null, editDraft: "", editStatus: "idle" as const,
    editError: null as string | null, editStreamingPatch: "", overallFeedbackDraft: "", feedbackStatus: "idle" as const, feedbackError: null as string | null,
    openuiVersions: [] as OpenUIEditVersion[], openuiVersionIndex: -1,
  };
}

let pendingProfileRequest: Promise<ProfileDigest | null> | null = null;
let skillMatchRequestId = 0;
const STEP_CACHE_LIMIT = 20;
const stepCache = new Map<string, InferApiResponse>();

function persistLayoutPreference(layoutMode: CardLayoutMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CARD_LAYOUT_STORAGE_KEY, layoutMode);
  } catch {
    // Storage may be unavailable in privacy-restricted embeds.
  }
  try {
    document.cookie = `${CARD_LAYOUT_STORAGE_KEY}=${encodeURIComponent(layoutMode)}; Max-Age=31536000; Path=/; SameSite=Lax`;
  } catch {
    // The in-memory selection remains authoritative for this session.
  }
}

function savedLayoutPreference(): CardLayoutMode | null {
  if (typeof window === "undefined") return null;
  try {
    const prefix = `${CARD_LAYOUT_STORAGE_KEY}=`;
    const encoded = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
    const value = encoded ? decodeURIComponent(encoded) : null;
    if (isCardLayoutMode(value)) return value;
  } catch {
    // Fall through to localStorage.
  }
  try {
    const stored = window.localStorage.getItem(CARD_LAYOUT_STORAGE_KEY);
    return isCardLayoutMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

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
  void abandonTaskRun(episode.id).catch(() => undefined);
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
  layoutMode: DEFAULT_CARD_LAYOUT_MODE,
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
  learningSettings: {
    id: "settings", enabled: true, learningMode: "manual", skillReuseEnabled: true,
    skillStepReuse: defaultSkillStepReuse(), skillMatchModel: "groq_qwen_3_6_27b", updatedAt: new Date(0).toISOString(),
  },
  skillMatches: [],
  selectedSkill: null,
  selectedSkillRecipe: null,
  queryAbstraction: null,
  skillMatchReport: null,
  selectedSkillInvocation: null,
  skillDecisionLocked: false,
  skills: [],
  skillVersions: [],
  skillCandidates: [],
  isSkillCenterOpen: false,
  skillMatchStatus: "idle",
  skillMatchError: null,
  skillMatchDiagnostics: null,
  ...clearedResult(),

  setQuery: (query) => {
    skillMatchRequestId += 1;
    persistAbandoned(get().currentEpisode);
    stepCache.clear();
    set({
      query,
      queryClassification: FEATURE_FLAGS.ADAPTIVE_QUERY_CLASSIFICATION ? classifyQuery(query) : { taskFamily: "general", decisionMode: "general", confidence: 1, source: "heuristic" },
      currentEpisode: null, isReflectionOpen: false,
      steps: emptySteps(),
      skillMatches: [], selectedSkill: null, selectedSkillRecipe: null, queryAbstraction: null, skillMatchReport: null, selectedSkillInvocation: null, skillDecisionLocked: false,
      skillMatchStatus: "idle", skillMatchError: null, skillMatchDiagnostics: null,
      ...clearedResult(),
    });
  },
  setLayoutMode: (layoutMode) => {
    if (get().layoutMode === layoutMode) return;
    skillMatchRequestId += 1;
    persistAbandoned(get().currentEpisode);
    stepCache.clear();
    persistLayoutPreference(layoutMode);
    set((state) => ({
      layoutMode,
      result: null,
      cardPlan: null,
      cardPlanMarkdown: null,
      reasoningGraph: null,
      openuiCode: null,
      openuiDiagnostics: null,
      assetManifest: null,
      openuiStreamMetrics: {},
      layoutStabilization: emptyLayoutStabilization(),
      openuiVersions: [],
      openuiVersionIndex: -1,
      cardEditTarget: null,
      rightView: null,
      currentEpisode: null,
      skillMatches: [], selectedSkill: null, selectedSkillRecipe: null, queryAbstraction: null, skillMatchReport: null, selectedSkillInvocation: null, skillDecisionLocked: false,
      skillMatchStatus: "idle", skillMatchError: null, skillMatchDiagnostics: null,
      steps: {
        ...state.steps,
        card_plan_generate: emptyStep(),
        openui_generate: emptyStep(),
      },
    }));
  },
  hydrateLayoutMode: () => {
    const saved = savedLayoutPreference();
    if (saved) get().setLayoutMode(saved);
  },
  setContextText: (contextText) => {
    skillMatchRequestId += 1;
    persistAbandoned(get().currentEpisode);
    stepCache.clear();
    set({
      contextText, profileStatus: "idle", profileDigest: null, profileError: null, profileContextText: null,
      steps: emptySteps(), currentEpisode: null, skillMatches: [], selectedSkill: null, selectedSkillRecipe: null, queryAbstraction: null, skillMatchReport: null, selectedSkillInvocation: null, skillDecisionLocked: false,
      skillMatchStatus: "idle", skillMatchError: null, skillMatchDiagnostics: null,
      ...clearedResult(),
    });
  },
  setCustomContextText: (text) => {
    skillMatchRequestId += 1;
    persistAbandoned(get().currentEpisode);
    set({
      customContextText: text, profileStatus: "idle", profileDigest: null, profileContextText: null,
      currentEpisode: null, steps: emptySteps(), skillMatches: [], selectedSkill: null, selectedSkillRecipe: null, queryAbstraction: null, skillMatchReport: null, selectedSkillInvocation: null, skillDecisionLocked: false,
      skillMatchStatus: "idle", skillMatchError: null, skillMatchDiagnostics: null,
      ...clearedResult(),
    });
  },
  answerQuestion: (index, value) => set((state) => ({ answers: { ...state.answers, [index]: value } })),
  setStepModel: (name, profile) => set((state) => ({
    stepModels: { ...state.stepModels, [name]: profile },
    steps: { ...state.steps, [name]: emptyStep() },
  })),
  setRightView: (rightView) => set({ rightView }),
  initializeLearning: async () => {
    try {
      const [stablePolicies, learningSettings, skills, skillVersions, skillCandidates] = await Promise.all([
        listPolicies(), getLearningSettings(), listSkills(), listSkillVersions(), listSkillCandidates(),
      ]);
      set({ stablePolicies, learningSettings, skills, skillVersions, skillCandidates });
    }
    catch { set({ stablePolicies: [] }); }
  },
  setTargeting: (isTargeting) => set({ isTargeting, ...(isTargeting ? { cardEditTarget: null, editError: null } : {}) }),
  setCardEditTarget: (cardEditTarget) => set({ cardEditTarget, isTargeting: false, editError: null }),
  setOverallFeedbackDraft: (overallFeedbackDraft) => set({ overallFeedbackDraft, feedbackStatus: "idle", feedbackError: null }),
  submitOverallFeedback: async () => {
    const state = get();
    const text = state.overallFeedbackDraft.trim();
    if (!state.currentEpisode || state.currentEpisode.status === "accepted" || !text) return;
    const episode = appendEpisodeFeedback(state.currentEpisode, text);
    set({ feedbackStatus: "saving", feedbackError: null });
    try {
      await putEpisode(episode);
      set({ currentEpisode: episode, overallFeedbackDraft: "", feedbackStatus: "saved", feedbackError: null });
    } catch (error) {
      set({ feedbackStatus: "error", feedbackError: error instanceof Error ? error.message : "整体反馈保存失败" });
    }
  },
  setEditDraft: (editDraft) => set({ editDraft }),
  setCardEditModelProfile: (cardEditModelProfile) => set({ cardEditModelProfile }),
  undoOpenUIEdit: () => set((state) => {
    const nextIndex = Math.max(0, state.openuiVersionIndex - 1);
    if (nextIndex === state.openuiVersionIndex || !state.openuiVersions[nextIndex]) return {};
    const layoutStabilization = emptyLayoutStabilization(state.cardPlan?.cards.length ?? 0);
    return {
      openuiVersionIndex: nextIndex,
      openuiCode: state.openuiVersions[nextIndex].code,
      editStatus: "idle",
      editError: null,
      currentEpisode: state.currentEpisode ? recordEpisodeUndo(state.currentEpisode) : null,
      layoutStabilization,
      openuiDiagnostics: state.openuiDiagnostics ? { ...state.openuiDiagnostics, layout: layoutStabilization } : null,
    };
  }),
  redoOpenUIEdit: () => set((state) => {
    const nextIndex = Math.min(state.openuiVersions.length - 1, state.openuiVersionIndex + 1);
    if (nextIndex === state.openuiVersionIndex || !state.openuiVersions[nextIndex]) return {};
    const layoutStabilization = emptyLayoutStabilization(state.cardPlan?.cards.length ?? 0);
    return {
      openuiVersionIndex: nextIndex,
      openuiCode: state.openuiVersions[nextIndex].code,
      editStatus: "idle",
      editError: null,
      layoutStabilization,
      openuiDiagnostics: state.openuiDiagnostics ? { ...state.openuiDiagnostics, layout: layoutStabilization } : null,
    };
  }),
  submitCardEdit: async () => {
    if (!FEATURE_FLAGS.OPENUI_CARD_EDIT) return;
    const state = get();
    if (state.layoutMode === "fixed-600x300" && !state.layoutStabilization.stable) {
      set({ editStatus: "error", editError: "固定布局尚未稳定，请等待布局优化完成" });
      return;
    }
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
        const layoutStabilization = emptyLayoutStabilization(current.cardPlan?.cards.length ?? 0);
        return {
          openuiCode: data.code,
          openuiVersions: versions,
          openuiVersionIndex: versions.length - 1,
          editStatus: "done",
          editError: null,
          editStreamingPatch: data.patch ?? current.editStreamingPatch,
          editDraft: "",
          currentEpisode: current.currentEpisode ? appendEpisodeEdit(current.currentEpisode, version) : null,
          layoutStabilization,
          openuiDiagnostics: current.openuiDiagnostics ? { ...current.openuiDiagnostics, layout: layoutStabilization } : null,
        };
      });
      const activeEpisode = get().currentEpisode;
      if (activeEpisode) void recordCardEdit(workflowRunId(activeEpisode.id), version).catch(() => undefined);
    } catch (error) {
      set({ editStatus: "error", editError: error instanceof Error ? error.message : "卡片编辑失败" });
    }
  },
  acceptCurrentEpisode: async () => {
    const state = get();
    if (!state.currentEpisode || !state.openuiCode) return;
    if (state.layoutMode === "fixed-600x300" && !state.layoutStabilization.stable) return;
    const episodeWithPendingFeedback = state.overallFeedbackDraft.trim()
      ? appendEpisodeFeedback(state.currentEpisode, state.overallFeedbackDraft)
      : state.currentEpisode;
    const episode = finalizeEpisode(episodeWithPendingFeedback, state.openuiCode);
    try {
      await putEpisode(episode);
    } catch (error) {
      set({ currentEpisode: episode, isReflectionOpen: true, reflectionStatus: "error", reflectionError: `最终 UI 已保留，但 Episode 持久化失败：${error instanceof Error ? error.message : "IndexedDB 不可用"}` });
      return;
    }
    if (state.cardPlan) {
      void acceptTaskRunAndCreateCandidate({
        episode,
        finalOpenUI: state.openuiCode,
        cardPlan: state.cardPlan,
        inferenceState: state.inferenceState,
        queryAbstraction: state.queryAbstraction,
      }).then(async (candidate) => {
        if (candidate && episode.edits.length === 0 && !(episode.feedback?.length)) {
          await autoPublishSkillCandidate({
            candidateId: candidate.id,
            name: state.queryAbstraction?.displayName ?? state.cardPlan?.skillName ?? "已接受生成流程",
            sourceSkillId: state.selectedSkill?.skillId,
          });
        }
        await get().refreshSkills();
      }).catch(() => undefined);
    }
    if (!FEATURE_FLAGS.REFLECTION_ATTRIBUTION || !state.learningSettings.enabled) {
      set({ currentEpisode: episode, overallFeedbackDraft: "", feedbackStatus: "saved", isReflectionOpen: false, reflectionStatus: "idle" });
      return;
    }
    set({ currentEpisode: episode, overallFeedbackDraft: "", feedbackStatus: "saved", isReflectionOpen: true, reflectionStatus: "attributing", attributionReport: null, gradientCandidates: [], candidateDecisions: {}, reflectionError: null });
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
    const settings: LearningSettings = { ...get().learningSettings, id: "settings", enabled: true, learningMode, updatedAt: new Date().toISOString() };
    await putLearningSettings(settings);
    set({ learningSettings: settings });
  },
  setSkillReuseEnabled: async (skillReuseEnabled) => {
    if (get().skillDecisionLocked) return;
    const settings: LearningSettings = { ...get().learningSettings, id: "settings", skillReuseEnabled, updatedAt: new Date().toISOString() };
    await putLearningSettings(settings);
    set({
      learningSettings: settings,
      ...(!skillReuseEnabled ? { selectedSkill: null, selectedSkillRecipe: null, queryAbstraction: null, skillMatchReport: null, selectedSkillInvocation: null, skillMatches: [], skillMatchStatus: "idle" as const, skillMatchError: null, skillMatchDiagnostics: null } : {}),
    });
    if (skillReuseEnabled) await get().prepareSkillReuse();
  },
  setSkillStepReuse: async (step, enabled) => {
    if (get().skillDecisionLocked) return;
    const skillStepReuse = { ...defaultSkillStepReuse(), ...(get().learningSettings.skillStepReuse ?? {}), [step]: enabled };
    const settings: LearningSettings = { ...get().learningSettings, id: "settings", skillStepReuse, updatedAt: new Date().toISOString() };
    await putLearningSettings(settings);
    set({ learningSettings: settings });
  },
  setSkillMatchModel: async (skillMatchModel) => {
    if (get().skillDecisionLocked) return;
    skillMatchRequestId += 1;
    const settings: LearningSettings = { ...get().learningSettings, id: "settings", skillMatchModel, updatedAt: new Date().toISOString() };
    await putLearningSettings(settings);
    set({ learningSettings: settings, selectedSkill: null, selectedSkillRecipe: null, queryAbstraction: null, skillMatchReport: null, selectedSkillInvocation: null, skillMatchStatus: "idle", skillMatchError: null, skillMatchDiagnostics: null });
    await get().prepareSkillReuse();
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
  reportOpenUILayout: async (measurements) => {
    const state = get();
    if (state.layoutMode !== "fixed-600x300" || !state.openuiCode || !state.cardPlan || state.steps.openui_generate.status !== "done") return;
    const fingerprint = stableTextHash(state.openuiCode);
    const signature = measurements.map((item) => `${item.cardId}:${item.scrollHeight}:${item.headerScrollHeight}:${item.bodyScrollHeight}`).join("|");
    const previousSignature = state.layoutStabilization.measurements.map((item) => `${item.cardId}:${item.scrollHeight}:${item.headerScrollHeight}:${item.bodyScrollHeight}`).join("|");
    if (state.layoutStabilization.artifactFingerprint === fingerprint && signature === previousSignature
      && (state.layoutStabilization.stable || state.layoutStabilization.status === "repairing" || state.layoutStabilization.status === "error")) return;
    const overflow = measurements.filter((item) => item.overflowing);
    const measured = { withinBudget: measurements.length - overflow.length, total: measurements.length };
    if (!overflow.length) {
      const next: OpenUILayoutStabilizationDiagnostics = {
        ...state.layoutStabilization,
        status: state.layoutStabilization.status === "fallback" ? "fallback" : "stable",
        measured, measurements, overflowCardIds: [], stable: true, artifactFingerprint: fingerprint,
      };
      set((current) => ({ layoutStabilization: next, openuiDiagnostics: current.openuiDiagnostics ? { ...current.openuiDiagnostics, layout: next } : null }));
      return;
    }
    if (state.layoutStabilization.repairAttempted) {
      const overflowCardIds = overflow.map((item) => item.cardId);
      if (state.layoutStabilization.status !== "fallback") {
        try {
          const code = buildDeterministicFixedOpenUI(state.cardPlan, state.assetManifest ?? undefined);
          const next: OpenUILayoutStabilizationDiagnostics = {
            ...state.layoutStabilization,
            status: "fallback",
            measured,
            measurements,
            overflowCardIds,
            fallbackCardIds: overflowCardIds,
            stable: false,
            artifactFingerprint: undefined,
            error: "模型布局修复后仍溢出，已切换为宿主确定性布局",
          };
          set((current) => ({
            openuiCode: code,
            openuiVersions: current.openuiVersions.length ? [{ ...current.openuiVersions[0], code }] : current.openuiVersions,
            openuiVersionIndex: current.openuiVersions.length ? 0 : current.openuiVersionIndex,
            layoutStabilization: next,
            openuiDiagnostics: current.openuiDiagnostics ? { ...current.openuiDiagnostics, layout: next } : null,
          }));
        } catch (error) {
          const next: OpenUILayoutStabilizationDiagnostics = {
            ...state.layoutStabilization,
            status: "error",
            measured,
            measurements,
            overflowCardIds,
            stable: false,
            artifactFingerprint: fingerprint,
            error: error instanceof Error ? error.message : "宿主确定性布局失败",
          };
          set((current) => ({ layoutStabilization: next, openuiDiagnostics: current.openuiDiagnostics ? { ...current.openuiDiagnostics, layout: next } : null }));
        }
        return;
      }
      const next: OpenUILayoutStabilizationDiagnostics = {
        ...state.layoutStabilization,
        status: "error",
        measured,
        measurements,
        overflowCardIds,
        stable: false,
        artifactFingerprint: fingerprint,
        error: "宿主确定性布局仍检测到溢出",
      };
      set((current) => ({ layoutStabilization: next, openuiDiagnostics: current.openuiDiagnostics ? { ...current.openuiDiagnostics, layout: next } : null }));
      return;
    }
    const repairing: OpenUILayoutStabilizationDiagnostics = {
      ...state.layoutStabilization, status: "repairing", measured, measurements,
      overflowCardIds: overflow.map((item) => item.cardId), repairAttempted: true, stable: false, artifactFingerprint: fingerprint,
    };
    set((current) => ({ layoutStabilization: repairing, openuiDiagnostics: current.openuiDiagnostics ? { ...current.openuiDiagnostics, layout: repairing } : null }));
    try {
      const response = await fetch("/api/openui/layout-repair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentCode: state.openuiCode, cardPlan: state.cardPlan, assetManifest: state.assetManifest ?? undefined, measurements: overflow, modelProfile: state.stepModels.openui_generate }),
      });
      const data = await response.json() as OpenUILayoutRepairResponse;
      if (!response.ok || !data.code) throw new Error(data.error ?? "布局修复失败");
      const fallback = data.strategy === "deterministic-fallback";
      const next: OpenUILayoutStabilizationDiagnostics = {
        ...repairing, status: fallback ? "fallback" : "measuring", repairSucceeded: !fallback,
        fallbackCardIds: fallback ? data.repairedCardIds : [], error: data.error,
      };
      set((current) => ({
        openuiCode: data.code,
        openuiVersions: current.openuiVersions.length ? [{ ...current.openuiVersions[0], code: data.code }] : current.openuiVersions,
        openuiVersionIndex: current.openuiVersions.length ? 0 : current.openuiVersionIndex,
        layoutStabilization: next,
        openuiDiagnostics: current.openuiDiagnostics ? { ...current.openuiDiagnostics, layout: next } : null,
      }));
    } catch (error) {
      const next: OpenUILayoutStabilizationDiagnostics = { ...repairing, status: "error", error: error instanceof Error ? error.message : "布局修复失败" };
      set((current) => ({ layoutStabilization: next, openuiDiagnostics: current.openuiDiagnostics ? { ...current.openuiDiagnostics, layout: next } : null }));
    }
  },
  refreshSkills: async () => {
    const [skills, skillVersions, skillCandidates] = await Promise.all([listSkills(), listSkillVersions(), listSkillCandidates()]);
    set({ skills, skillVersions, skillCandidates });
  },
  setSkillCenterOpen: (isSkillCenterOpen) => set({ isSkillCenterOpen }),
  prepareSkillReuse: async () => {
    const requestId = ++skillMatchRequestId;
    const state = get();
    if (!FEATURE_FLAGS.SKILL_REUSE || state.learningSettings.skillReuseEnabled === false) {
      set({
        skillMatches: [], selectedSkill: null, selectedSkillRecipe: null, queryAbstraction: null,
        skillMatchReport: null, selectedSkillInvocation: null, skillMatchStatus: "idle",
        skillMatchError: null, skillMatchDiagnostics: null,
      });
      return;
    }
    set({ skillMatchStatus: "matching", skillMatchError: null, skillMatchDiagnostics: null });
    const profileDigest = state.profileDigest ?? await state.ensureProfileDigest();
    const current = get();
    const modelProfile = current.learningSettings.skillMatchModel ?? "groq_qwen_3_6_27b";
    const profileContext = {
      domains: (profileDigest?.domains ?? []).map((domain) => domain.name).slice(0, 30),
      retrievalKeys: [...new Set((profileDigest?.domains ?? []).flatMap((domain) => domain.retrievalKeys))].slice(0, 60),
    };
    let abstraction: QueryAbstractionV1;
    let abstractionDiagnostics: Pick<NonNullable<InferState["skillMatchDiagnostics"]>, "abstractionModel" | "abstractionDurationMs" | "abstractionPromptTokens"> = {};
    try {
      const abstractionResponse = await fetch("/api/skills/abstract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: current.query,
          classification: current.queryClassification,
          layoutMode: current.layoutMode,
          profileContext,
          modelProfile,
        }),
      });
      const abstractionWire = await abstractionResponse.json() as {
        abstraction?: QueryAbstractionV1;
        error?: string;
        model?: string;
        durationMs?: number;
        usage?: { prompt?: number };
      };
      if (!abstractionResponse.ok || abstractionWire.error || !abstractionWire.abstraction) {
        throw new Error(abstractionWire.error ?? "任务抽象未返回有效结果");
      }
      abstraction = abstractionWire.abstraction;
      abstractionDiagnostics = {
        abstractionModel: abstractionWire.model ?? modelProfile,
        abstractionDurationMs: abstractionWire.durationMs,
        abstractionPromptTokens: abstractionWire.usage?.prompt,
      };
    } catch (error) {
      if (requestId !== skillMatchRequestId) return;
      const local = await rankMatchableSkills({
        query: current.query, classification: current.queryClassification, layoutMode: current.layoutMode, profileDigest,
      });
      const matches = local
        .filter((candidate) => candidate.score >= SKILL_SUGGEST_THRESHOLD)
        .map((candidate) => ({
          ...candidate,
          activation: "suggested" as const,
          autoBlockReasons: ["任务抽象模型不可用，本地候选禁止自动应用"],
        }));
      if (requestId !== skillMatchRequestId) return;
      set({
        queryAbstraction: null,
        skillMatchReport: null,
        skillMatches: matches,
        selectedSkill: null,
        selectedSkillRecipe: null,
        selectedSkillInvocation: null,
        skillMatchStatus: "fallback",
        skillMatchError: `任务抽象不可用，已回退旧版本地匹配：${error instanceof Error ? error.message : "未知错误"}`,
        skillMatchDiagnostics: {
          candidateCount: Math.min(local.length, EXTERNAL_SKILL_CANDIDATE_LIMIT),
          decisionLogs: matches.length
            ? matches.map((candidate) => `FALLBACK · ${candidate.skill.name} · ${candidate.autoBlockReasons?.[0]}`)
            : ["NO_MATCH · 任务抽象失败，且没有本地候选"],
        },
      });
      return;
    }
    if (requestId !== skillMatchRequestId) return;
    const ranked = await rankMatchableSkills({
      query: current.query, classification: current.queryClassification, layoutMode: current.layoutMode, profileDigest, abstraction,
    });
    if (requestId !== skillMatchRequestId) return;
    if (!ranked.length) {
      set({
        queryAbstraction: abstraction, skillMatchReport: null, skillMatches: [], selectedSkill: null,
        selectedSkillRecipe: null, selectedSkillInvocation: null, skillMatchStatus: "ready",
        skillMatchDiagnostics: { ...abstractionDiagnostics, candidateCount: 0, decisionLogs: ["NO_MATCH · 没有有效、已发布且协议兼容的 Skill"] },
      });
      return;
    }
    let matches: SkillMatchCandidate[];
    let matchReport: SkillMatchReport | null = null;
    let status: InferState["skillMatchStatus"] = "ready";
    let matchError: string | null = null;
    let diagnostics: InferState["skillMatchDiagnostics"] = {
      ...abstractionDiagnostics,
      candidateCount: Math.min(ranked.length, EXTERNAL_SKILL_CANDIDATE_LIMIT),
    };
    try {
      const candidates = ranked.slice(0, EXTERNAL_SKILL_CANDIDATE_LIMIT);
      const response = await fetch("/api/skills/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          abstraction,
          classification: current.queryClassification,
          layoutMode: current.layoutMode,
          profileContext,
          modelProfile,
          candidates: candidates.map(toExternalCandidateView),
        }),
      });
      const wire = await response.json() as ExternalSkillMatchWireResult & { error?: string };
      if (requestId !== skillMatchRequestId) return;
      if (!response.ok || wire.error) throw new Error(wire.error ?? "外部 Skill 匹配失败");
      matches = applyExternalSkillRanking(candidates, wire, modelProfile, abstraction, current.layoutMode);
      matchReport = buildSkillMatchReport(wire, matches);
      diagnostics = {
        ...abstractionDiagnostics,
        model: wire.model ?? modelProfile,
        durationMs: wire.durationMs,
        promptTokens: wire.usage?.prompt,
        candidateCount: candidates.length,
        decisionLogs: buildSkillMatchDecisionLogs(candidates, wire, matches),
      };
    } catch (error) {
      if (requestId !== skillMatchRequestId) return;
      const fallbackReason = `外部匹配模型不可用：${error instanceof Error ? error.message : "未知错误"}`;
      matches = ranked
        .filter((candidate) => candidate.score >= SKILL_SUGGEST_THRESHOLD)
        .map((candidate) => ({ ...candidate, activation: "suggested" as const, autoBlockReasons: [fallbackReason] }));
      status = "fallback";
      matchError = `外部匹配不可用，已回退本地：${error instanceof Error ? error.message : "未知错误"}`;
      diagnostics = {
        ...diagnostics,
        decisionLogs: matches.length
          ? matches.map((candidate) => `FALLBACK · ${candidate.skill.name} · ${fallbackReason}`)
          : [`NO_MATCH · ${fallbackReason}，且没有达到建议阈值的本地候选`],
      };
    }
    const currentManual = current.selectedSkill?.activation === "manual"
      ? ranked.find((candidate) => candidate.skill.id === current.selectedSkill?.skillId)
      : undefined;
    if (currentManual && !matches.some((candidate) => candidate.skill.id === currentManual.skill.id)) matches = [currentManual, ...matches];
    const chosen = currentManual ?? matches.find((candidate) => candidate.activation === "auto");
    const invocation = chosen ? buildSkillInvocation(chosen, abstraction) : null;
    if (requestId !== skillMatchRequestId) return;
    set({
      queryAbstraction: abstraction,
      skillMatchReport: matchReport,
      skillMatches: matches,
      selectedSkill: chosen ? selectionFromMatch(chosen, currentManual ? "manual" : chosen.activation) : null,
      selectedSkillRecipe: chosen?.recipe ?? null,
      selectedSkillInvocation: invocation,
      skillMatchStatus: status,
      skillMatchError: matchError,
      skillMatchDiagnostics: diagnostics,
    });
  },
  selectSkillMatch: (skillId) => {
    if (get().skillDecisionLocked) return;
    if (!skillId) {
      set({ selectedSkill: null, selectedSkillRecipe: null, selectedSkillInvocation: null });
      return;
    }
    const candidate = get().skillMatches.find((item) => item.skill.id === skillId);
    if (candidate) set({
      selectedSkill: selectionFromMatch(candidate, "manual"),
      selectedSkillRecipe: candidate.recipe,
      selectedSkillInvocation: get().queryAbstraction ? buildSkillInvocation(candidate, get().queryAbstraction!) : null,
    });
  },

  selectPreset: (id) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    skillMatchRequestId += 1;
    persistAbandoned(get().currentEpisode);
    stepCache.clear();
    set({ deviceContext: preset, contextText: pretty(preset.records), steps: emptySteps(), isMock: false, profileStatus: "idle", profileDigest: null, profileError: null, profileContextText: null, currentEpisode: null, skillMatches: [], selectedSkill: null, selectedSkillRecipe: null, queryAbstraction: null, skillMatchReport: null, selectedSkillInvocation: null, skillDecisionLocked: false, skillMatchStatus: "idle", skillMatchError: null, skillMatchDiagnostics: null, ...clearedResult() });
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
      await get().prepareSkillReuse();
      set({ skillDecisionLocked: true });
      set({ currentEpisode: createGenerationEpisode({ query, classification: get().queryClassification }), isReflectionOpen: false });
    }
    const captureEpisode = get().currentEpisode;
    if (captureEpisode) {
      try {
        const initialState = get();
        await startTaskRun({
          episodeId: captureEpisode.id, query, classification: initialState.queryClassification, layoutMode: initialState.layoutMode,
          skillSelection: initialState.selectedSkill ?? undefined,
          skillStepReuse: { ...defaultSkillStepReuse(), ...(initialState.learningSettings.skillStepReuse ?? {}) },
          queryAbstraction: initialState.queryAbstraction ?? undefined,
          skillMatchReport: initialState.skillMatchReport ?? undefined,
          skillInvocation: initialState.selectedSkillInvocation ?? undefined,
        });
      } catch {
        // Workflow capture is best-effort and must never block generation.
      }
    }
    let deviceContext: Record<string, unknown>;
    try {
      deviceContext = JSON.parse(contextText);
    } catch {
      if (captureEpisode) void failTaskRun(captureEpisode.id).catch(() => undefined);
      set((state) => ({ steps: { ...state.steps, [name]: { ...state.steps[name], status: "error", error: "设备上下文不是合法 JSON" } } }));
      return;
    }
    let capturedStepRunId: string | undefined;

    set((state) => ({
      ...(name === "card_plan_generate" ? { result: null, cardPlan: null, cardPlanMarkdown: null, reasoningGraph: null, openuiCode: null, openuiDiagnostics: null, assetManifest: null, openuiVersions: [], openuiVersionIndex: -1, rightView: "cardplan-markdown" as const } : {}),
      ...(name === "openui_generate" ? { openuiCode: null, openuiDiagnostics: null, assetManifest: null, openuiStreamMetrics: {}, layoutStabilization: emptyLayoutStabilization(), openuiVersions: [], openuiVersionIndex: -1, cardEditTarget: null, rightView: "openui" as const } : {}),
      steps: { ...state.steps, [name]: { ...state.steps[name], status: "loading", streamingChars: 0, error: null, logs: [] } },
    }));

    try {
      const ensuredProfile = await get().ensureProfileDigest();
      if (name === "intent_analysis" && !ensuredProfile) {
        if (captureEpisode) void failTaskRun(captureEpisode.id).catch(() => undefined);
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
      const reuseEnabledForStep = FEATURE_FLAGS.SKILL_REUSE
        && state.learningSettings.skillReuseEnabled !== false
        && (state.learningSettings.skillStepReuse?.[name] ?? true)
        && !!state.selectedSkill
        && !!state.selectedSkillRecipe;
      const skillContext = reuseEnabledForStep
        ? buildSkillStepContext(state.selectedSkillRecipe!, state.selectedSkill!, name, state.selectedSkillInvocation ?? undefined)
        : undefined;
      const requestBody = {
        query, deviceContext, step: name,
        layoutMode: state.layoutMode,
        modelProfile: state.stepModels[name],
        ...(FEATURE_FLAGS.ADAPTIVE_QUERY_CLASSIFICATION ? { classification: state.queryClassification } : {}),
        ...(adaptiveContext ? { adaptiveContext } : {}),
        ...(skillContext ? { skillContext } : {}),
        ...(name === "intent_analysis" ? { profileDigest: ensuredProfile } : {}),
        ...(name === "intent_analysis" && state.customContextText.trim().length > 20 ? { profileSourceText: state.customContextText.trim() } : {}),
        ...(name !== "intent_analysis" && name !== "openui_generate" ? { inferenceState: state.inferenceState } : {}),
        ...(name === "context_enrichment" || name === "card_plan_generate" ? { userAnswers: state.answers } : {}),
        ...(name === "context_enrichment" && freshPrefetch ? { prefetchedSearch: freshPrefetch } : {}),
        ...(name === "openui_generate" ? {
          cardPlan: state.cardPlan,
          mediaPlanningDiagnostics: state.steps.card_plan_generate.outputs.mediaPlanningDiagnostics,
          stream: true,
        } : {}),
      };
      const episode = state.currentEpisode ?? captureEpisode;
      if (episode) {
        try {
          await startTaskRun({
            episodeId: episode.id, query, classification: state.queryClassification, layoutMode: state.layoutMode,
            skillSelection: state.selectedSkill ?? undefined,
            skillStepReuse: { ...defaultSkillStepReuse(), ...(state.learningSettings.skillStepReuse ?? {}) },
          });
          const answerArtifactId = name === "context_enrichment"
            ? await recordClarificationAnswers(workflowRunId(episode.id), state.answers)
            : undefined;
          capturedStepRunId = (await beginStepCapture({
            runId: workflowRunId(episode.id), step: name, request: requestBody,
            modelProfile: state.stepModels[name], policyId: adaptiveContext?.policyId,
            policyVersion: adaptiveContext?.policyVersion, steeringHint: adaptiveContext?.stepHint,
            skillSelection: skillContext?.selection,
            dependencyArtifactIds: answerArtifactId ? [answerArtifactId] : undefined,
          })).id;
        } catch {
          // Workflow capture is best-effort and must never block generation.
        }
      }
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
        if (episode && capturedStepRunId) void failStepCapture(workflowRunId(episode.id), capturedStepRunId, data.error ?? "推理失败").catch(() => undefined);
        set((current) => ({ steps: { ...current.steps, [name]: { ...current.steps[name], status: "error", error: data.error ?? "推理失败", logs: data._logs ?? [] } } }));
        return;
      }

      if (episode && capturedStepRunId) {
        try {
          await completeStepCapture({
            runId: workflowRunId(episode.id), stepRunId: capturedStepRunId, step: name,
            output: {
              inferenceState: data.inferenceState, questions: data.questions, cardPlan: data.cardPlan,
              cardPlanMarkdown: data.cardPlanMarkdown, openuiCode: data.openuiCode,
              openuiDiagnostics: data.openuiDiagnostics, assetManifest: data.assetManifest,
              outputs: data.outputs, provenance: data.provenance, model: data.model,
              modelProfile: data.modelProfile, timing: data.timing, usage: data.usage,
              adaptive: data.adaptive,
              skillReuse: data.skillReuse,
            },
          });
        } catch {
          // Workflow capture is best-effort and must never block generation.
        }
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
        layoutStabilization: data.openuiDiagnostics?.layout ?? current.layoutStabilization,
        assetManifest: data.assetManifest ?? current.assetManifest,
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
            skillReuse: data.skillReuse,
          },
        },
      };
      });

    } catch (error) {
      if (captureEpisode && capturedStepRunId) void failStepCapture(workflowRunId(captureEpisode.id), capturedStepRunId, error).catch(() => undefined);
      set((current) => ({ steps: { ...current.steps, [name]: { ...current.steps[name], status: "error", error: error instanceof Error ? error.message : "网络错误" } } }));
    }
  },

  runAll: async () => {
    persistAbandoned(get().currentEpisode);
    await get().ensureProfileDigest();
    await get().prepareSkillReuse();
    set({
      runAllPaused: false,
      currentEpisode: createGenerationEpisode({ query: get().query, classification: get().queryClassification, userKey: get().profileDigest?.contextHash }),
      isReflectionOpen: false,
      skillDecisionLocked: true,
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
    set({ query: DEFAULT_QUERY, queryClassification: FEATURE_FLAGS.ADAPTIVE_QUERY_CLASSIFICATION ? classifyQuery(DEFAULT_QUERY) : { taskFamily: "general", decisionMode: "general", confidence: 1, source: "heuristic" }, deviceContext: presets[0], contextText: pretty(presets[0].records), steps: emptySteps(), stepModels: defaultStepModels(), cardEditModelProfile: "glm_5_2", isMock: false, profileStatus: "idle", profileDigest: null, profileError: null, profileContextText: null, currentEpisode: null, isReflectionOpen: false, skillMatches: [], selectedSkill: null, selectedSkillRecipe: null, queryAbstraction: null, skillMatchReport: null, selectedSkillInvocation: null, skillDecisionLocked: false, skillMatchStatus: "idle", skillMatchError: null, skillMatchDiagnostics: null, ...clearedResult() });
  },
}));
