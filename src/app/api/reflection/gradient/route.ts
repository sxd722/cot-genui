import type { AdaptivePolicyEntry } from "@/lib/adaptive/types";
import type { GenerationEpisode } from "@/learning/types";
import { canCallModelProfile } from "@/lib/modelProfiles";
import { buildReflectionEpisodeView } from "@/lib/reflection/attribution";
import { ATTRIBUTION_TO_POLICY_TARGET, eligibleAttributionTargets, normalizeGradientCandidates } from "@/lib/reflection/gradient";
import { callReflectionJson } from "@/lib/reflection/model";
import { GRADIENT_SYSTEM_PROMPT } from "@/lib/reflection/prompts";
import type { AttributionReport } from "@/lib/reflection/types";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { REFLECTION_MODEL_PROFILE } from "@/lib/reflection/config";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!FEATURE_FLAGS.REFLECTION_GRADIENT) return Response.json({ error: "Reflection gradient feature is disabled" }, { status: 404 });
  let body: { episode?: GenerationEpisode; attribution?: AttributionReport; currentPolicy?: AdaptivePolicyEntry };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 }); }
  if (!body.episode || body.episode.status !== "accepted" || !body.attribution || !body.currentPolicy) return Response.json({ error: "缺少 gradient 输入" }, { status: 400 });
  const targets = eligibleAttributionTargets(body.attribution);
  if (!targets.length) return Response.json({ candidates: [], reasonCode: "no_gradient" });
  if (!canCallModelProfile(REFLECTION_MODEL_PROFILE)) return Response.json({ error: "反思固定使用 glm-5.2 Thinking，但当前缺少 LLM_API_KEY" }, { status: 503 });
  try {
    const value = await callReflectionJson(GRADIENT_SYSTEM_PROMPT, {
      episode: buildReflectionEpisodeView(body.episode),
      targets: targets.map((target) => ({ attributionTarget: target, policyTarget: ATTRIBUTION_TO_POLICY_TARGET[target], probability: body.attribution!.distribution[target] })),
      currentPolicy: { profileOverlay: body.currentPolicy.profileOverlay, stepHints: body.currentPolicy.stepHints },
    });
    return Response.json({ candidates: normalizeGradientCandidates(value, { episode: body.episode, attribution: body.attribution, currentPolicy: body.currentPolicy }), modelProfile: REFLECTION_MODEL_PROFILE });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "策略候选生成失败" }, { status: 500 });
  }
}
