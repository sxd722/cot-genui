import type { GenerationEpisode } from "@/learning/types";
import { inferEditIntentHeuristic } from "./editIntent";
import { ATTRIBUTION_TARGETS, EDIT_INTENTS, type AttributionDistribution, type AttributionReport, type AttributionTarget, type EditIntent, type ReflectionEpisodeView } from "./types";

const ZERO = (): AttributionDistribution => ({ profile: 0, step1: 0, step2: 0, step3: 0, step4: 0, step5: 0, step6: 0 });

export function entropy(distribution: AttributionDistribution): number {
  return ATTRIBUTION_TARGETS.reduce((sum, target) => {
    const probability = distribution[target];
    return probability > 0 ? sum - probability * Math.log2(probability) : sum;
  }, 0);
}

export function normalizeAttributionReport(value: unknown, editIntents: EditIntent[], modelUsed: boolean): AttributionReport {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawDistribution = raw.distribution && typeof raw.distribution === "object" ? raw.distribution as Record<string, unknown> : {};
  const distribution = ZERO();
  ATTRIBUTION_TARGETS.forEach((target) => { distribution[target] = Math.max(0, Math.min(1, Number(rawDistribution[target]) || 0)); });
  const sum = ATTRIBUTION_TARGETS.reduce((total, target) => total + distribution[target], 0);
  if (sum > 0) ATTRIBUTION_TARGETS.forEach((target) => { distribution[target] /= sum; });
  const sorted = [...ATTRIBUTION_TARGETS].sort((left, right) => distribution[right] - distribution[left]);
  const rawTop = Array.isArray(raw.topTargets) ? raw.topTargets : [];
  const topTargets = sorted.filter((target) => distribution[target] > 0).slice(0, 3).map((target) => {
    const supplied = rawTop.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).target === target) as Record<string, unknown> | undefined;
    const evidence = Array.isArray(supplied?.evidence) ? supplied.evidence.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 240)).slice(0, 3) : [];
    return { target, probability: distribution[target], evidence };
  });
  const reasonCodes = Array.isArray(raw.reasonCodes) ? raw.reasonCodes.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 80)).slice(0, 8) : [];
  if ((distribution[sorted[0]] - distribution[sorted[1]] < 0.12 || entropy(distribution) > 2.2) && !reasonCodes.includes("ambiguous_credit")) reasonCodes.push("ambiguous_credit");
  return { editIntents: editIntents.filter((intent) => EDIT_INTENTS.includes(intent)), distribution, topTargets, reasonCodes, modelUsed, entropy: entropy(distribution) };
}

export function deterministicAttribution(episode: GenerationEpisode): AttributionReport | null {
  if (!episode.edits.length) return { editIntents: [], distribution: ZERO(), topTargets: [], reasonCodes: ["accepted_without_edits"], modelUsed: false, entropy: 0 };
  const inferred = episode.edits.map(inferEditIntentHeuristic);
  if (!inferred.every((item) => ["visual", "layout", "interaction"].includes(item.intent) && !item.semanticCorrection)) return null;
  const distribution = ZERO();
  inferred.forEach((item) => {
    if (item.intent === "visual") { distribution.step6 += 0.97; distribution.step5 += 0.03; }
    else if (item.intent === "layout") { distribution.step6 += 0.78; distribution.step5 += 0.22; }
    else { distribution.step6 += 0.92; distribution.step5 += 0.08; }
  });
  const count = inferred.length;
  ATTRIBUTION_TARGETS.forEach((target) => { distribution[target] /= count; });
  return normalizeAttributionReport({
    distribution,
    topTargets: [
      { target: "step6", evidence: ["修改通过卡片内 targeting 发起，且要求集中在视觉、布局或交互表达。"] },
      { target: "step5", evidence: ["布局调整可能少量涉及 CardPlan 的信息组织。"] },
    ],
    reasonCodes: ["targeted_ui_edit", "no_semantic_correction"],
  }, inferred.map((item) => item.intent), false);
}

export function attributionPrior(intents: EditIntent[]): AttributionDistribution {
  const distribution = ZERO();
  const add = (values: Partial<AttributionDistribution>) => ATTRIBUTION_TARGETS.forEach((target) => { distribution[target] += values[target] ?? 0; });
  intents.forEach((intent) => {
    if (intent === "visual") add({ step6: 0.95, step5: 0.05 });
    else if (intent === "layout") add({ step6: 0.75, step5: 0.2, step4: 0.05 });
    else if (intent === "interaction") add({ step6: 0.9, step5: 0.1 });
    else if (intent === "card_structure") add({ step5: 0.65, step6: 0.3, step4: 0.05 });
    else if (intent === "priority_change") add({ step5: 0.35, step4: 0.25, step1: 0.2, step6: 0.1, profile: 0.1 });
    else if (intent === "fact_correction") add({ step2: 0.3, step4: 0.2, step5: 0.2, profile: 0.15, step1: 0.1, step6: 0.05 });
    else if (intent === "goal_correction") add({ step1: 0.55, step4: 0.2, step5: 0.15, profile: 0.05, step6: 0.05 });
    else add({ step5: 0.35, step4: 0.25, step1: 0.15, step6: 0.15, profile: 0.1 });
  });
  const count = Math.max(1, intents.length);
  ATTRIBUTION_TARGETS.forEach((target) => { distribution[target] /= count; });
  return distribution;
}

function signals(episode: GenerationEpisode, step: keyof GenerationEpisode["steps"]): string[] {
  return episode.steps[step]?.provenance?.outputSignals ?? [];
}

export function buildReflectionEpisodeView(episode: GenerationEpisode): ReflectionEpisodeView {
  const step1 = episode.steps.intent_analysis?.provenance;
  const profileView = step1?.profileView;
  const step1Signals = signals(episode, "intent_analysis");
  const step4Signals = signals(episode, "context_enrichment");
  return {
    query: episode.query,
    classification: episode.queryClassification,
    profile: {
      overlay: profileView?.profileOverlay,
      selectedDetails: (profileView?.selectedDetails ?? []).map(({ ref, text }) => ({ ref, text })).slice(0, 30),
    },
    step1: {
      taskType: step1Signals.find((item) => !item.startsWith("requirement:") && !item.startsWith("retrieval:") && !item.startsWith("fulfillment:")),
      requirements: step1Signals.filter((item) => item.startsWith("requirement:")).slice(0, 30),
      retrievalRequests: step1Signals.filter((item) => item.startsWith("retrieval:")).slice(0, 20),
    },
    step2: { slots: signals(episode, "evidence_resolution").filter((item) => item.startsWith("slot:")).slice(0, 40), sourceRefs: episode.steps.evidence_resolution?.provenance?.sourceRefs ?? [] },
    step3: { questions: signals(episode, "clarification").filter((item) => item.startsWith("question:")).slice(0, 20) },
    step4: { summary: step4Signals[0], assumptions: step4Signals.slice(1, 30) },
    step5: { cardPlanMarkdown: episode.steps.card_plan_generate?.provenance?.cardPlanMarkdown },
    step6: { relevantInitialCardSlices: [...new Set(episode.edits.map((edit) => edit.beforeSlice))].slice(0, 8) },
    edits: episode.edits.map((edit) => ({ cardId: edit.cardId, target: edit.target, instruction: edit.instruction, beforeCardSlice: edit.beforeSlice, afterCardSlice: edit.afterSlice })),
  };
}

export function targetProbability(report: AttributionReport, target: AttributionTarget): number { return report.distribution[target]; }
