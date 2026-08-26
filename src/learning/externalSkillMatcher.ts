import type { CardLayoutMode } from "../dsl/modules";
import type { QueryClassification } from "../lib/adaptive/types";
import type { ExternalSkillMatcherModel } from "./workflowTypes";
import type {
  QueryAbstractionV1,
  SkillInvocation,
  SkillMatchComparison,
  SkillMatchReport,
} from "./workflowTypes";
import type { SkillMatchCandidate } from "./skillMatcher";
import { SKILL_AUTO_MARGIN, SKILL_AUTO_THRESHOLD, SKILL_SUGGEST_THRESHOLD } from "./skillMatcher";
import { displayQueryAbstraction } from "./queryAbstraction";

export const EXTERNAL_SKILL_MATCHER_VERSION = "external-llm-v1" as const;
export const EXTERNAL_SKILL_CANDIDATE_LIMIT = 24;
export const EXTERNAL_PARAMETER_CONFIDENCE_THRESHOLD = 0.8;

export interface ExternalSkillCandidateView {
  skillId: string;
  versionId: string;
  name: string;
  description: string;
  taskFamilies: string[];
  decisionModes: string[];
  semanticText: string;
  intentKey: string;
  intentDisplayName: string;
  invariantTerms: string[];
  parameterKeys: string[];
  parameterKinds: string[];
  domains: string[];
  slotKeys: string[];
  profileDomains: string[];
  capabilities: string[];
  cardArchetypes: string[];
  layoutModes: CardLayoutMode[];
  actionTypes: string[];
  requiresFreshData: boolean;
}

export interface ExternalSkillMatchRequest {
  abstraction: QueryAbstractionV1;
  classification: QueryClassification;
  layoutMode: CardLayoutMode;
  profileContext: { domains: string[]; retrievalKeys: string[] };
  modelProfile: ExternalSkillMatcherModel;
  candidates: ExternalSkillCandidateView[];
}

export interface ExternalSkillMatchWireResult {
  comparisons: SkillMatchComparison[];
  noMatchReason?: string;
  model?: string;
  modelProfile?: ExternalSkillMatcherModel;
  usage?: { prompt: number; completion: number; total: number };
  durationMs?: number;
}

function safeIndexText(value: string, max: number): string {
  return value
    .replace(/(?:https?:\/\/|data:|javascript:|file:\/\/)\S*/gi, "[redacted]")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

export function toExternalCandidateView(candidate: SkillMatchCandidate): ExternalSkillCandidateView {
  const profile = candidate.version.indexProfile;
  return {
    skillId: candidate.skill.id,
    versionId: candidate.version.id,
    name: safeIndexText(candidate.skill.name, 160) || "Unnamed Skill",
    description: safeIndexText(candidate.skill.description, 500),
    taskFamilies: profile.taskFamilies,
    decisionModes: profile.decisionModes,
    semanticText: safeIndexText(profile.semanticText, 500),
    intentKey: safeIndexText(profile.intentKey ?? candidate.recipe.intentTemplate.intentKey, 80),
    intentDisplayName: safeIndexText(profile.intentDisplayName ?? candidate.recipe.intentTemplate.displayName, 100),
    invariantTerms: (profile.invariantTerms ?? candidate.recipe.intentTemplate.invariantTerms).slice(0, 20),
    parameterKeys: (profile.parameterKeys ?? candidate.recipe.intentTemplate.parameters.map((parameter) => parameter.key)).slice(0, 30),
    parameterKinds: (profile.parameterKinds ?? candidate.recipe.intentTemplate.parameters.map((parameter) => parameter.valueKind)).slice(0, 30),
    domains: profile.domains.slice(0, 20),
    slotKeys: profile.slotKeys.slice(0, 30),
    profileDomains: profile.profileDomains.slice(0, 20),
    capabilities: profile.capabilities.slice(0, 12),
    cardArchetypes: profile.cardArchetypes.slice(0, 12),
    layoutModes: profile.layoutModes,
    actionTypes: profile.actionTypes.slice(0, 12),
    requiresFreshData: profile.requiresFreshData,
  };
}

function boundedScore(value: unknown): number {
  const score = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, score));
}

export function applyExternalSkillRanking(
  candidates: SkillMatchCandidate[],
  wire: ExternalSkillMatchWireResult,
  modelProfile: ExternalSkillMatcherModel,
  abstraction: QueryAbstractionV1,
  layoutMode?: CardLayoutMode,
): SkillMatchCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.skill.id, candidate]));
  const currentParameters = new Map(abstraction.parameters.map((parameter) => [parameter.key, parameter]));
  const seen = new Set<string>();
  const ranked = (Array.isArray(wire.comparisons) ? wire.comparisons : []).flatMap((match) => {
    if (!match || typeof match.skillId !== "string" || seen.has(match.skillId)) return [];
    const candidate = byId.get(match.skillId);
    if (!candidate || match.decision === "rejected") return [];
    seen.add(match.skillId);
    const llmScore = boundedScore(match.score);
    const skillKeys = new Set(candidate.recipe.intentTemplate.parameters.map((parameter) => parameter.key));
    const mappings = (Array.isArray(match.parameterMappings) ? match.parameterMappings : []).flatMap((mapping) => {
      const current = currentParameters.get(mapping.currentKey);
      if (!current || !skillKeys.has(mapping.skillKey)) return [];
      return [{
        currentKey: current.key,
        skillKey: mapping.skillKey,
        value: current.value,
        confidence: boundedScore(mapping.confidence),
      }];
    });
    const reusableSteps = [...new Set([
      ...(match.reusableSteps ?? []),
      "intent_analysis" as const,
      "clarification" as const,
      "card_plan_generate" as const,
      "openui_generate" as const,
    ])];
    const rerunSteps = [...new Set([
      ...(match.rerunSteps ?? []),
      "evidence_resolution" as const,
      ...(candidate.version.indexProfile.requiresFreshData ? ["context_enrichment" as const] : []),
      "card_plan_generate" as const,
      "openui_generate" as const,
    ])];
    const comparison: SkillMatchComparison = {
      skillId: candidate.skill.id,
      score: llmScore,
      decision: match.decision === "compatible" ? "compatible" : "partial",
      summary: safeIndexText(match.summary ?? "", 300),
      matchedInvariants: (match.matchedInvariants ?? []).map((item) => safeIndexText(item, 100)).filter(Boolean).slice(0, 20),
      parameterMappings: mappings,
      conflicts: (match.conflicts ?? []).map((item) => safeIndexText(item, 240)).filter(Boolean).slice(0, 20),
      reusableSteps: reusableSteps.slice(0, 6),
      rerunSteps: rerunSteps.slice(0, 6),
      reasonCodes: (match.reasonCodes ?? []).map((item) => safeIndexText(item, 80)).filter(Boolean).slice(0, 12),
    };
    const confidentlyMappedCurrent = new Set(mappings
      .filter((mapping) => mapping.confidence >= EXTERNAL_PARAMETER_CONFIDENCE_THRESHOLD)
      .map((mapping) => mapping.currentKey));
    const missingCurrentKeys = abstraction.parameters
      .filter((parameter) => !confidentlyMappedCurrent.has(parameter.key))
      .map((parameter) => parameter.key);
    const guardBlockReasons = [
      ...(abstraction.confidence < EXTERNAL_PARAMETER_CONFIDENCE_THRESHOLD
        ? [`任务抽象置信度 ${Math.round(abstraction.confidence * 100)}% 低于 ${Math.round(EXTERNAL_PARAMETER_CONFIDENCE_THRESHOLD * 100)}%`]
        : []),
      ...(missingCurrentKeys.length ? [`当前参数未完整映射：${missingCurrentKeys.join(", ")}`] : []),
    ];
    const decisionNotes = layoutMode && !candidate.version.indexProfile.layoutModes.includes(layoutMode)
      ? [`历史 Skill 布局 ${candidate.version.indexProfile.layoutModes.join("/") || "unknown"} 已由当前布局 ${layoutMode} 覆盖`]
      : [];
    return [{
      candidate: {
        ...candidate,
        score: llmScore,
        matcherVersion: EXTERNAL_SKILL_MATCHER_VERSION,
        matcherModel: modelProfile,
        reasons: ["external-semantic", ...candidate.reasons].slice(0, 12),
        matchExplanation: comparison.summary,
        matchComparison: comparison,
      },
      guardBlockReasons,
      decisionNotes,
    }];
  }).sort((left, right) => right.candidate.score - left.candidate.score);
  return ranked.map(({ candidate, guardBlockReasons, decisionNotes }, index) => {
    const margin = Math.max(0, candidate.score - (ranked[index + 1]?.candidate.score ?? 0));
    const autoBlockReasons = [
      ...(index !== 0 ? ["不是最高分候选"] : []),
      ...(candidate.matchComparison?.decision !== "compatible" ? [`模型决策为 ${candidate.matchComparison?.decision ?? "unknown"}`] : []),
      ...(candidate.matchComparison?.conflicts.length ? [`存在冲突：${candidate.matchComparison.conflicts.join("；")}`] : []),
      ...guardBlockReasons,
      ...(candidate.score < SKILL_AUTO_THRESHOLD
        ? [`模型分数 ${Math.round(candidate.score * 100)}% 低于自动阈值 ${Math.round(SKILL_AUTO_THRESHOLD * 100)}%`]
        : []),
      ...(index === 0 && margin < SKILL_AUTO_MARGIN
        ? [`领先差值 ${Math.round(margin * 100)}% 低于阈值 ${Math.round(SKILL_AUTO_MARGIN * 100)}%`]
        : []),
    ];
    return {
      ...candidate,
      margin,
      autoBlockReasons,
      decisionNotes: [
        ...decisionNotes,
        ...(!autoBlockReasons.length ? ["模型决策与宿主安全门槛均通过"] : []),
      ],
      activation: !autoBlockReasons.length ? "auto" as const : "suggested" as const,
    };
  }).filter((candidate) => candidate.score >= SKILL_SUGGEST_THRESHOLD);
}

/** Compact, value-free logs suitable for the development UI and failure diagnosis. */
export function buildSkillMatchDecisionLogs(
  candidates: SkillMatchCandidate[],
  wire: ExternalSkillMatchWireResult,
  matches: SkillMatchCandidate[],
): string[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.skill.id, candidate]));
  const matchById = new Map(matches.map((candidate) => [candidate.skill.id, candidate]));
  const logs = (wire.comparisons ?? []).map((comparison) => {
    const source = candidateById.get(comparison.skillId);
    const match = matchById.get(comparison.skillId);
    const name = source?.skill.name ?? comparison.skillId;
    if (!match) {
      const reason = comparison.decision === "rejected"
        ? `模型拒绝${comparison.conflicts.length ? `：${comparison.conflicts.join("；")}` : ""}`
        : `模型分数 ${Math.round(comparison.score * 100)}% 低于建议阈值 ${Math.round(SKILL_SUGGEST_THRESHOLD * 100)}%`;
      return `REJECTED · ${name} · ${reason}`;
    }
    if (match.activation === "auto") {
      return `AUTO · ${name} · 模型 ${Math.round(match.score * 100)}% · margin ${Math.round(match.margin * 100)}%${match.decisionNotes?.length ? ` · ${match.decisionNotes.join("；")}` : ""}`;
    }
    return `SUGGESTED · ${name} · 模型 ${Math.round(match.score * 100)}% · 未自动应用：${match.autoBlockReasons?.join("；") || "未通过宿主门槛"}`;
  });
  return logs.length ? logs : [wire.noMatchReason ? `NO_MATCH · ${wire.noMatchReason}` : "NO_MATCH · 匹配模型未返回候选比较"];
}

export function buildSkillMatchReport(wire: ExternalSkillMatchWireResult, candidates: SkillMatchCandidate[] = []): SkillMatchReport {
  const normalized = new Map(candidates.flatMap((candidate) => (
    candidate.matchComparison ? [[candidate.skill.id, {
      ...candidate.matchComparison,
      parameterMappings: candidate.matchComparison.parameterMappings.map((mapping) => ({
        currentKey: mapping.currentKey,
        skillKey: mapping.skillKey,
        confidence: mapping.confidence,
      })),
    }] as const] : []
  )));
  return {
    formatVersion: "genui-skill-match-report/1",
    comparisons: (Array.isArray(wire.comparisons) ? wire.comparisons : []).map((comparison) => (
      normalized.get(comparison.skillId) ?? comparison
    )),
    noMatchReason: wire.noMatchReason,
  };
}

export function buildSkillInvocation(candidate: SkillMatchCandidate, abstraction: QueryAbstractionV1): SkillInvocation {
  const comparison = candidate.matchComparison;
  const bindings = comparison?.parameterMappings ?? [];
  const mappedCurrent = new Set(bindings.map((binding) => binding.currentKey));
  const mappedSkill = new Set(bindings.map((binding) => binding.skillKey));
  const unmatchedParameters = abstraction.parameters.filter((parameter) => !mappedCurrent.has(parameter.key));
  const missingRequiredKeys = candidate.recipe.intentTemplate.parameters
    .filter((parameter) => parameter.required && !mappedSkill.has(parameter.key))
    .map((parameter) => parameter.key);
  const conflicts = comparison?.conflicts ?? [];
  return {
    formatVersion: "genui-skill-invocation/1",
    skillId: candidate.skill.id,
    skillVersionId: candidate.version.id,
    intentKey: abstraction.intentKey,
    displayText: displayQueryAbstraction(abstraction),
    bindings,
    unmatchedParameters,
    missingRequiredKeys,
    conflicts,
    reusableSteps: comparison?.reusableSteps ?? [],
    rerunSteps: comparison?.rerunSteps ?? [],
    deterministicIntentEligible: comparison?.decision === "compatible"
      && abstraction.confidence >= EXTERNAL_PARAMETER_CONFIDENCE_THRESHOLD
      && !conflicts.length
      && !unmatchedParameters.length
      && bindings.every((binding) => binding.confidence >= EXTERNAL_PARAMETER_CONFIDENCE_THRESHOLD),
  };
}
