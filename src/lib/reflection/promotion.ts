import type { AdaptivePolicyEntry } from "@/lib/adaptive/types";
import { defaultHintFor, emptyStepHints } from "../adaptive/defaultPolicies";
import { PIPELINE_STEPS } from "../pipelineTypes";
import type { GenerationEpisode, LearningSettings, PolicyObservation } from "@/learning/types";
import type { PolicyGradientCandidate } from "./types";

function latestMatching(policies: AdaptivePolicyEntry[], candidate: PolicyGradientCandidate) {
  return policies
    .filter((policy) => policy.status === "stable" && policy.scope === candidate.scopeSuggestion && policy.taskFamily === candidate.taskFamily && (candidate.scopeSuggestion !== "user-class" || policy.userKey === candidate.userKey))
    .sort((left, right) => right.version - left.version)[0];
}

function defaultPolicy(candidate: Pick<PolicyGradientCandidate, "taskFamily">): AdaptivePolicyEntry {
  const stepHints = emptyStepHints();
  PIPELINE_STEPS.forEach((step) => { stepHints[step] = defaultHintFor(candidate.taskFamily, step); });
  return { id: "default", scope: "class", taskFamily: candidate.taskFamily, profileOverlay: "", stepHints, version: 0, status: "stable", supportCount: 0, updatedAt: new Date(0).toISOString() };
}

export function reflectionPolicyForEpisode(episode: GenerationEpisode, policies: AdaptivePolicyEntry[]): AdaptivePolicyEntry {
  const userPolicy = policies.filter((policy) => policy.status === "stable" && policy.scope === "user-class" && policy.taskFamily === episode.queryClassification.taskFamily && policy.userKey === episode.userKey).sort((left, right) => right.version - left.version)[0];
  const classPolicy = policies.filter((policy) => policy.status === "stable" && policy.scope === "class" && policy.taskFamily === episode.queryClassification.taskFamily).sort((left, right) => right.version - left.version)[0];
  const globalPolicy = policies.filter((policy) => policy.status === "stable" && policy.scope === "global").sort((left, right) => right.version - left.version)[0];
  return userPolicy ?? classPolicy ?? globalPolicy ?? defaultPolicy({ taskFamily: episode.queryClassification.taskFamily });
}

export function promoteCandidate(candidate: PolicyGradientCandidate, policies: AdaptivePolicyEntry[]): AdaptivePolicyEntry {
  const base = latestMatching(policies, candidate) ?? defaultPolicy(candidate);
  const version = Math.max(0, ...policies.filter((policy) => policy.scope === candidate.scopeSuggestion && policy.taskFamily === candidate.taskFamily && policy.userKey === (candidate.scopeSuggestion === "user-class" ? candidate.userKey : undefined)).map((policy) => policy.version)) + 1;
  const stepHints = { ...base.stepHints };
  let profileOverlay = base.profileOverlay;
  if (candidate.target === "profileOverlay") profileOverlay = candidate.candidateText;
  else stepHints[candidate.target] = candidate.candidateText;
  const scopeKey = candidate.scopeSuggestion === "user-class" ? `${candidate.userKey}:${candidate.taskFamily}` : candidate.taskFamily;
  return {
    id: `${candidate.scopeSuggestion}:${scopeKey}:v${version}`,
    scope: candidate.scopeSuggestion,
    taskFamily: candidate.taskFamily,
    userKey: candidate.scopeSuggestion === "user-class" ? candidate.userKey : undefined,
    profileOverlay,
    stepHints,
    version,
    status: "stable",
    supportCount: base.supportCount + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function observationFromCandidate(episode: GenerationEpisode, candidate: PolicyGradientCandidate): PolicyObservation {
  return {
    id: `observation_${episode.id}_${candidate.id}`,
    episodeId: episode.id,
    taskFamily: candidate.taskFamily,
    userKey: candidate.userKey,
    target: candidate.target,
    themeKey: candidate.themeKey,
    candidateText: candidate.candidateText,
    confidence: candidate.confidence,
    attributionProbability: candidate.attributionProbability,
    decision: "pending",
    createdAt: new Date().toISOString(),
  };
}

export function canGuardedAutoPromote(args: {
  candidate: PolicyGradientCandidate;
  observations: PolicyObservation[];
  settings: LearningSettings;
  acceptedEpisodes: GenerationEpisode[];
}): boolean {
  if (args.settings.learningMode !== "guarded-auto") return false;
  const scope = args.candidate.scopeSuggestion;
  if (scope === "user-class" && args.acceptedEpisodes.filter((episode) => episode.status === "accepted" && episode.userKey === args.candidate.userKey && episode.queryClassification.taskFamily === args.candidate.taskFamily).length < 3) return false;
  const matching = args.observations.filter((item) => item.taskFamily === args.candidate.taskFamily && item.userKey === (scope === "user-class" ? args.candidate.userKey : undefined) && item.target === args.candidate.target && item.themeKey === args.candidate.themeKey);
  if (matching.some((item) => item.decision === "discarded")) return false;
  if (matching.length < 3) return false;
  const meanConfidence = matching.reduce((sum, item) => sum + item.confidence, 0) / matching.length;
  const meanAttribution = matching.reduce((sum, item) => sum + item.attributionProbability, 0) / matching.length;
  return meanConfidence >= 0.8 && meanAttribution >= 0.55;
}

export function rollbackPolicy(target: AdaptivePolicyEntry, policies: AdaptivePolicyEntry[]): AdaptivePolicyEntry {
  const version = Math.max(0, ...policies.filter((policy) => policy.scope === target.scope && policy.taskFamily === target.taskFamily && policy.userKey === target.userKey).map((policy) => policy.version)) + 1;
  return { ...target, id: `${target.scope}:${target.userKey ? `${target.userKey}:` : ""}${target.taskFamily ?? "global"}:v${version}`, version, updatedAt: new Date().toISOString(), status: "stable" };
}
