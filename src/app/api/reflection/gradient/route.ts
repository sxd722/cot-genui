import type { AdaptivePolicyEntry } from "@/lib/adaptive/types";
import type { GenerationEpisode } from "@/learning/types";
import { canCallModelProfile } from "@/lib/modelProfiles";
import { MODEL_PROFILES, type ModelProfile } from "@/lib/pipelineTypes";
import { buildReflectionEpisodeView } from "@/lib/reflection/attribution";
import { ATTRIBUTION_TO_POLICY_TARGET, eligibleAttributionTargets, normalizeGradientCandidates } from "@/lib/reflection/gradient";
import { callReflectionJson } from "@/lib/reflection/model";
import { GRADIENT_SYSTEM_PROMPT } from "@/lib/reflection/prompts";
import type { AttributionReport } from "@/lib/reflection/types";

export const runtime = "nodejs";
function isProfile(value: unknown): value is ModelProfile { return typeof value === "string" && (MODEL_PROFILES as readonly string[]).includes(value); }

export async function POST(request: Request) {
  let body: { episode?: GenerationEpisode; attribution?: AttributionReport; currentPolicy?: AdaptivePolicyEntry; modelProfile?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 }); }
  if (!body.episode || body.episode.status !== "accepted" || !body.attribution || !body.currentPolicy) return Response.json({ error: "缺少 gradient 输入" }, { status: 400 });
  const targets = eligibleAttributionTargets(body.attribution);
  if (!targets.length) return Response.json({ candidates: [], reasonCode: "no_gradient" });
  const modelProfile = isProfile(body.modelProfile) ? body.modelProfile : "groq_qwen_3_6_27b";
  if (!canCallModelProfile(modelProfile)) return Response.json({ error: "策略候选模型缺少 API key" }, { status: 503 });
  try {
    const value = await callReflectionJson(GRADIENT_SYSTEM_PROMPT, {
      episode: buildReflectionEpisodeView(body.episode),
      targets: targets.map((target) => ({ attributionTarget: target, policyTarget: ATTRIBUTION_TO_POLICY_TARGET[target], probability: body.attribution!.distribution[target] })),
      currentPolicy: { profileOverlay: body.currentPolicy.profileOverlay, stepHints: body.currentPolicy.stepHints },
    }, modelProfile);
    return Response.json({ candidates: normalizeGradientCandidates(value, { episode: body.episode, attribution: body.attribution, currentPolicy: body.currentPolicy }) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "策略候选生成失败" }, { status: 500 });
  }
}

