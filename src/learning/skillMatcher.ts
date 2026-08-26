import type { CardLayoutMode } from "../dsl/modules";
import type { QueryClassification } from "../lib/adaptive/types";
import type { ProfileDigest } from "../lib/profileTypes";
import { getLearningDatabase } from "./database";
import { materializeSkillRecipe } from "./skillPackage";
import type { ExternalSkillMatcherModel, QueryAbstractionV1, SkillMatchActivation, SkillMatchComparison, SkillMatcherVersion, SkillRecipe, SkillRecord, SkillReuseSelection, SkillVersionRecord } from "./workflowTypes";

export const SKILL_MATCHER_VERSION = "local-lexical-v1" as const;
export const SKILL_AUTO_THRESHOLD = 0.82;
export const SKILL_SUGGEST_THRESHOLD = 0.62;
export const SKILL_AUTO_MARGIN = 0.08;

export interface SkillMatchInput {
  query: string;
  classification: QueryClassification;
  layoutMode: CardLayoutMode;
  profileDigest?: ProfileDigest | null;
  abstraction?: QueryAbstractionV1 | null;
}

export interface SkillMatchCandidate {
  skill: SkillRecord;
  version: SkillVersionRecord;
  recipe: SkillRecipe;
  score: number;
  margin: number;
  activation: "auto" | "suggested";
  reasons: string[];
  matcherVersion: SkillMatcherVersion;
  matcherModel?: ExternalSkillMatcherModel;
  matchExplanation?: string;
  matchComparison?: SkillMatchComparison;
  /** Host-verifiable reasons that prevented automatic reuse. Empty means auto-eligible. */
  autoBlockReasons?: string[];
  /** Non-blocking decision notes such as runtime layout overrides. */
  decisionNotes?: string[];
  breakdown: {
    intentTemplate: number;
    taskFamily: number;
    decisionMode: number;
    semantic: number;
    domains: number;
    profileCoverage: number;
    parameterShape: number;
    layout: number;
  };
}

function tokenize(text: string): Set<string> {
  const normalized = text.toLocaleLowerCase().normalize("NFKC");
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  const hanRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const han = hanRuns.flatMap((run) => {
    const chars = [...run];
    if (chars.length <= 2) return [run];
    return chars.slice(0, -1).map((_, index) => chars.slice(index, index + 2).join(""));
  });
  return new Set([...latin, ...han].filter((token) => token.length >= 2));
}

function overlap(left: Iterable<string>, right: Iterable<string>): number {
  const a = new Set([...left].map((item) => item.toLocaleLowerCase()));
  const b = new Set([...right].map((item) => item.toLocaleLowerCase()));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((item) => { if (b.has(item)) shared += 1; });
  return shared / Math.max(1, Math.min(a.size, b.size));
}

export function scoreSkill(input: SkillMatchInput, version: SkillVersionRecord) {
  const profile = version.indexProfile;
  const queryTokens = tokenize(input.abstraction
    ? [input.abstraction.invariantSummary, ...input.abstraction.invariantTerms].join(" ")
    : input.query);
  const skillTokens = tokenize([profile.semanticText, ...profile.intentTerms].join(" "));
  const profileDomains = new Set((input.profileDigest?.domains ?? []).map((domain) => domain.name.toLocaleLowerCase()));
  const slotCoverage = overlap(profile.slotKeys, input.profileDigest?.domains.flatMap((domain) => domain.retrievalKeys) ?? []);
  const domainCoverage = overlap(profile.profileDomains, profileDomains);
  const currentParameterKeys = input.abstraction?.parameters.map((parameter) => parameter.key) ?? [];
  const currentParameterKinds = input.abstraction?.parameters.map((parameter) => parameter.valueKind) ?? [];
  const indexedParameterKeys = profile.parameterKeys ?? profile.slotKeys;
  const indexedParameterKinds = profile.parameterKinds ?? [];
  const intentTemplate = input.abstraction && profile.intentKey === input.abstraction.intentKey ? 0.30 : 0;
  const parameterShape = Math.max(
    overlap(currentParameterKeys, indexedParameterKeys),
    overlap(currentParameterKinds, indexedParameterKinds),
  ) * 0.20;
  const breakdown = input.abstraction ? {
    intentTemplate,
    taskFamily: profile.taskFamilies.includes(input.classification.taskFamily) ? 0.15 : 0,
    decisionMode: profile.decisionModes.includes(input.classification.decisionMode) ? 0.10 : 0,
    parameterShape,
    semantic: overlap(queryTokens, skillTokens) * 0.10,
    domains: overlap(profile.domains, profileDomains) * 0.05,
    profileCoverage: Math.max(domainCoverage, slotCoverage) * 0.05,
    layout: profile.layoutModes.includes(input.layoutMode) ? 0.05 : 0,
  } : {
    intentTemplate: 0,
    taskFamily: profile.taskFamilies.includes(input.classification.taskFamily) ? 0.30 : 0,
    decisionMode: profile.decisionModes.includes(input.classification.decisionMode) ? 0.15 : 0,
    parameterShape: 0,
    semantic: overlap(queryTokens, skillTokens) * 0.25,
    domains: overlap(profile.domains, profileDomains) * 0.15,
    profileCoverage: Math.max(domainCoverage, slotCoverage) * 0.10,
    layout: profile.layoutModes.includes(input.layoutMode) ? 0.05 : 0,
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const reasons = Object.entries(breakdown).filter(([, value]) => value > 0).map(([key]) => key);
  return { score: Math.round(score * 10_000) / 10_000, breakdown, reasons };
}

export async function rankMatchableSkills(input: SkillMatchInput): Promise<SkillMatchCandidate[]> {
  const database = getLearningDatabase();
  const skills = await database.skills.where("status").equals("active").toArray();
  const materialized = await Promise.all(skills.map(async (skill) => {
    const version = await database.skillVersions.get(skill.activeVersionId);
    if (!version || version.status !== "published" || !version.compatibility.includes("six-step-v1")) return null;
    try {
      const recipe = await materializeSkillRecipe(version.id);
      const scored = scoreSkill(input, version);
      return { skill, version, recipe, ...scored };
    } catch {
      return null;
    }
  }));
  const ranked = materialized.filter((item): item is NonNullable<typeof item> => !!item)
    .sort((left, right) => right.score - left.score || right.version.version - left.version.version);
  return ranked.map((item, index) => {
    const margin = Math.max(0, item.score - (ranked[index + 1]?.score ?? 0));
    const auto = index === 0 && item.score >= SKILL_AUTO_THRESHOLD && margin >= SKILL_AUTO_MARGIN;
    return {
      ...item, margin, activation: auto ? "auto" as const : "suggested" as const,
      matcherVersion: SKILL_MATCHER_VERSION,
    };
  });
}

export async function matchSkills(input: SkillMatchInput): Promise<SkillMatchCandidate[]> {
  return (await rankMatchableSkills(input)).filter((item) => item.score >= SKILL_SUGGEST_THRESHOLD);
}

export function selectionFromMatch(candidate: SkillMatchCandidate, activation: SkillMatchActivation = candidate.activation): SkillReuseSelection {
  return {
    skillId: candidate.skill.id,
    skillVersionId: candidate.version.id,
    recipeFingerprint: candidate.version.recipeFingerprint,
    score: candidate.score,
    margin: candidate.margin,
    activation,
    matcherVersion: candidate.matcherVersion,
    matcherModel: candidate.matcherModel,
    reasons: candidate.reasons,
  };
}
