import type { GenerationEpisode } from "@/learning/types";
import { canCallModelProfile } from "@/lib/modelProfiles";
import { attributionPrior, buildReflectionEpisodeView, deterministicAttribution, normalizeAttributionReport } from "@/lib/reflection/attribution";
import { inferEditIntentHeuristic, inferFeedbackIntentHeuristic } from "@/lib/reflection/editIntent";
import { callReflectionJson } from "@/lib/reflection/model";
import { ATTRIBUTION_SYSTEM_PROMPT } from "@/lib/reflection/prompts";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { REFLECTION_MODEL_PROFILE } from "@/lib/reflection/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!FEATURE_FLAGS.REFLECTION_ATTRIBUTION) return Response.json({ error: "Reflection attribution feature is disabled" }, { status: 404 });
  let body: { episode?: GenerationEpisode };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 }); }
  const episode = body.episode;
  if (!episode || episode.status !== "accepted" || !Array.isArray(episode.edits)) return Response.json({ error: "缺少已接受的 GenerationEpisode" }, { status: 400 });
  const fast = deterministicAttribution(episode);
  if (fast) return Response.json({ report: fast });
  if (!canCallModelProfile(REFLECTION_MODEL_PROFILE)) return Response.json({ error: "反思固定使用 glm-5.2 Thinking，但当前缺少 LLM_API_KEY" }, { status: 503 });
  try {
    const view = buildReflectionEpisodeView(episode);
    const intents = [
      ...episode.edits.map((edit) => inferEditIntentHeuristic(edit).intent),
      ...(episode.feedback ?? []).map((feedback) => inferFeedbackIntentHeuristic(feedback.text).intent),
    ];
    const value = await callReflectionJson(ATTRIBUTION_SYSTEM_PROMPT, { episode: view, inferredEditIntents: intents, attributionPrior: attributionPrior(intents), instruction: "Treat overallFeedback as user-authored evidence about the complete card flow even when no patch exists. Return zero distribution for pure praise/no-change feedback. Only move probability away from the prior when topTargets includes concrete field or short-text evidence." });
    return Response.json({ report: normalizeAttributionReport(value, intents, true), modelProfile: REFLECTION_MODEL_PROFILE });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "阶段归因失败" }, { status: 500 });
  }
}
