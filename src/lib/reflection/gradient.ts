import type { AdaptivePolicyEntry } from "@/lib/adaptive/types";
import { sanitizeProfileOverlay, sanitizeSteeringHint } from "../adaptive/validation";
import type { GenerationEpisode } from "@/learning/types";
import { PIPELINE_STEPS, type PipelineStepName } from "../pipelineTypes";
import type { AttributionReport, AttributionTarget, PolicyGradientCandidate } from "./types";

export const ATTRIBUTION_TO_POLICY_TARGET: Record<AttributionTarget, "profileOverlay" | PipelineStepName> = {
  profile: "profileOverlay",
  step1: "intent_analysis",
  step2: "evidence_resolution",
  step3: "clarification",
  step4: "context_enrichment",
  step5: "card_plan_generate",
  step6: "openui_generate",
};

const FORBIDDEN_PROTOCOL = /schema|json\s*字段|response_format|tool_choice|新增步骤|跳过|调用搜索|改模型|更换模型|Query|Mutation|OpenUI\s*root/i;
const DIRECT_ENTITY = /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:¥|￥|\$)\s*\d|\b20\d{2}[-/.年]\d{1,2}|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/i;

export function eligibleAttributionTargets(report: AttributionReport): AttributionTarget[] {
  return [...Object.entries(report.distribution) as Array<[AttributionTarget, number]>]
    .filter(([, probability]) => probability >= 0.35)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([target]) => target);
}

function overlapTokens(episode: GenerationEpisode): string[] {
  const markdown = episode.steps.card_plan_generate?.provenance?.cardPlanMarkdown ?? "";
  const explicit = [episode.query, ...episode.edits.map((edit) => edit.cardId), ...(episode.feedback ?? []).map((feedback) => feedback.text)]
    .flatMap((value) => value.split(/[\s,，。！？:：/\\|()[\]{}]+/))
    .filter((value) => [...value].length >= 4);
  const headings = [...markdown.matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) => match[1].replace(/[`*_]/g, "").trim()).filter((value) => [...value].length >= 4);
  return [...new Set([...explicit, ...headings])].slice(0, 40);
}

function semanticJump(previous: string, candidate: string): boolean {
  if (!previous.trim()) return false;
  const previousTerms = new Set(previous.split(/[\s，。；、]+/).filter((term) => [...term].length >= 2));
  const candidateTerms = new Set(candidate.split(/[\s，。；、]+/).filter((term) => [...term].length >= 2));
  if (!previousTerms.size || !candidateTerms.size) return false;
  return [...previousTerms].every((term) => !candidateTerms.has(term));
}

export function previousPolicyText(policy: AdaptivePolicyEntry, target: PolicyGradientCandidate["target"]): string {
  return target === "profileOverlay" ? policy.profileOverlay : policy.stepHints[target];
}

export function validateGradientCandidate(candidate: PolicyGradientCandidate, episode: GenerationEpisode): { valid: boolean; reason?: string; semanticJump: boolean; candidate?: PolicyGradientCandidate } {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(candidate.themeKey)) return { valid: false, reason: "themeKey 必须是通用 snake_case", semanticJump: false };
  if (candidate.target !== "profileOverlay" && !PIPELINE_STEPS.includes(candidate.target)) return { valid: false, reason: "candidate target 越界", semanticJump: false };
  const sanitized = candidate.target === "profileOverlay" ? sanitizeProfileOverlay(candidate.candidateText) : sanitizeSteeringHint(candidate.candidateText);
  const limit = candidate.target === "profileOverlay" ? 160 : 120;
  if (!sanitized || [...sanitized].length > limit) return { valid: false, reason: "candidate 为空、过长或未通过基础安全校验", semanticJump: false };
  if (FORBIDDEN_PROTOCOL.test(sanitized) || DIRECT_ENTITY.test(sanitized)) return { valid: false, reason: "candidate 包含协议指令或 episode 实体", semanticJump: false };
  if ((sanitized.match(/[。！？!?]/g) ?? []).length > 1) return { valid: false, reason: "candidate 必须是单句", semanticJump: false };
  if (overlapTokens(episode).some((token) => [...token].length >= 4 && sanitized.includes(token))) return { valid: false, reason: "candidate 复用了本 episode 的具体实体或标题", semanticJump: false };
  const cleaned: PolicyGradientCandidate = {
    ...candidate,
    candidateText: sanitized,
    confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0)),
    attributionProbability: Math.max(0, Math.min(1, Number(candidate.attributionProbability) || 0)),
    rationaleSummary: candidate.rationaleSummary.filter((item) => typeof item === "string").map((item) => item.slice(0, 180)).slice(0, 3),
  };
  return { valid: true, semanticJump: semanticJump(candidate.previousText, sanitized), candidate: cleaned };
}

export function normalizeGradientCandidates(value: unknown, args: {
  episode: GenerationEpisode;
  attribution: AttributionReport;
  currentPolicy: AdaptivePolicyEntry;
}): PolicyGradientCandidate[] {
  const eligible = eligibleAttributionTargets(args.attribution);
  const allowed = new Map(eligible.map((target) => [ATTRIBUTION_TO_POLICY_TARGET[target], args.attribution.distribution[target]]));
  const raw = value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).candidates) ? (value as { candidates: unknown[] }).candidates : [];
  const output: PolicyGradientCandidate[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const target = candidate.target as PolicyGradientCandidate["target"];
    const probability = allowed.get(target);
    if (probability === undefined) continue;
    const scopeSuggestion = candidate.scopeSuggestion === "user-class" && !!args.episode.userKey ? "user-class" : "class";
    const normalized: PolicyGradientCandidate = {
      id: `candidate_${Date.now().toString(36)}_${index}`,
      taskFamily: args.episode.queryClassification.taskFamily,
      userKey: scopeSuggestion === "user-class" ? args.episode.userKey : undefined,
      target,
      themeKey: typeof candidate.themeKey === "string" ? candidate.themeKey : "",
      previousText: previousPolicyText(args.currentPolicy, target),
      candidateText: typeof candidate.candidateText === "string" ? candidate.candidateText : "",
      confidence: Number(candidate.confidence) || 0,
      attributionProbability: probability,
      scopeSuggestion,
      rationaleSummary: Array.isArray(candidate.rationaleSummary) ? candidate.rationaleSummary.filter((entry): entry is string => typeof entry === "string") : [],
    };
    const validation = validateGradientCandidate(normalized, args.episode);
    if (validation.valid && validation.candidate) output.push(validation.candidate);
    if (output.length >= 2) break;
  }
  return output;
}
