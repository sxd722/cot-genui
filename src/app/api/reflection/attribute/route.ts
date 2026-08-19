import type { GenerationEpisode } from "@/learning/types";
import { canCallModelProfile } from "@/lib/modelProfiles";
import { MODEL_PROFILES, type ModelProfile } from "@/lib/pipelineTypes";
import { attributionPrior, buildReflectionEpisodeView, deterministicAttribution, normalizeAttributionReport } from "@/lib/reflection/attribution";
import { inferEditIntentHeuristic } from "@/lib/reflection/editIntent";
import { callReflectionJson } from "@/lib/reflection/model";
import { ATTRIBUTION_SYSTEM_PROMPT } from "@/lib/reflection/prompts";
import { FEATURE_FLAGS } from "@/lib/featureFlags";

export const runtime = "nodejs";

function profile(value: unknown): value is ModelProfile { return typeof value === "string" && (MODEL_PROFILES as readonly string[]).includes(value); }

export async function POST(request: Request) {
  if (!FEATURE_FLAGS.REFLECTION_ATTRIBUTION) return Response.json({ error: "Reflection attribution feature is disabled" }, { status: 404 });
  let body: { episode?: GenerationEpisode; modelProfile?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 }); }
  const episode = body.episode;
  if (!episode || episode.status !== "accepted" || !Array.isArray(episode.edits)) return Response.json({ error: "缺少已接受的 GenerationEpisode" }, { status: 400 });
  const fast = deterministicAttribution(episode);
  if (fast) return Response.json({ report: fast });
  const selectedProfile = profile(body.modelProfile) ? body.modelProfile : "groq_qwen_3_6_27b";
  if (!canCallModelProfile(selectedProfile)) return Response.json({ error: "反思模型缺少 API key" }, { status: 503 });
  try {
    const view = buildReflectionEpisodeView(episode);
    const intents = episode.edits.map((edit) => inferEditIntentHeuristic(edit).intent);
    const value = await callReflectionJson(ATTRIBUTION_SYSTEM_PROMPT, { episode: view, inferredEditIntents: intents, attributionPrior: attributionPrior(intents), instruction: "Only move probability away from the prior when topTargets includes concrete field or short-text evidence." }, selectedProfile);
    return Response.json({ report: normalizeAttributionReport(value, intents, true) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "阶段归因失败" }, { status: 500 });
  }
}
