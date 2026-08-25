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
  localScore: number;
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
    localScore: candidate.score,
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
    const score = Math.round((llmScore * 0.7 + candidate.score * 0.3) * 10_000) / 10_000;
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
    const mappedCurrent = new Set(mappings.map((mapping) => mapping.currentKey));
    const mappedSkill = new Set(mappings.map((mapping) => mapping.skillKey));
    for (const current of abstraction.parameters) {
      if (mappedCurrent.has(current.key) || mappedSkill.has(current.key) || !skillKeys.has(current.key)) continue;
      mappings.push({
        currentKey: current.key,
        skillKey: current.key,
        value: current.value,
        confidence: Math.min(current.confidence, 0.95),
      });
    }
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
    return [{
      ...candidate,
      score,
      matcherVersion: EXTERNAL_SKILL_MATCHER_VERSION,
      matcherModel: modelProfile,
      reasons: ["external-semantic", ...candidate.reasons].slice(0, 12),
      matchExplanation: comparison.summary,
      matchComparison: comparison,
    }];
  }).sort((left, right) => right.score - left.score);
  return ranked.map((candidate, index) => {
    const margin = Math.max(0, candidate.score - (ranked[index + 1]?.score ?? 0));
    return {
      ...candidate,
      margin,
      activation: index === 0 && candidate.matchComparison?.decision === "compatible"
        && !(candidate.matchComparison?.conflicts.length)
        && candidate.score >= SKILL_AUTO_THRESHOLD && margin >= SKILL_AUTO_MARGIN
        ? "auto" as const
        : "suggested" as const,
    };
  }).filter((candidate) => candidate.score >= SKILL_SUGGEST_THRESHOLD);
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
      && abstraction.confidence >= 0.75
      && !conflicts.length
      && !unmatchedParameters.length,
  };
}
