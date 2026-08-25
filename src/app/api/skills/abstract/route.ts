import OpenAI from "openai";
import { z } from "zod";
import { DECISION_MODES, TASK_FAMILIES } from "@/lib/adaptive/types";
import { createLLMClient, extractJson } from "@/lib/llm";
import { canCallModelProfile, resolveModelProfile } from "@/lib/modelProfiles";
import { validateQueryAbstraction } from "@/learning/queryAbstraction";
import type { ExternalSkillMatcherModel } from "@/learning/workflowTypes";

export const runtime = "nodejs";

const modelSchema = z.enum(["groq_qwen_3_6_27b", "glm_5_2"]);
const safeIndex = z.string().trim().min(1).max(100).refine(
  (value) => !/(?:https?:\/\/|data:|javascript:|file:\/\/|[\u0000-\u001F])/i.test(value),
  "画像索引不得包含 URL 或控制字符",
);
const requestSchema = z.object({
  query: z.string().trim().min(1).max(10_000),
  classification: z.object({
    taskFamily: z.enum(TASK_FAMILIES),
    decisionMode: z.enum(DECISION_MODES),
    confidence: z.number().min(0).max(1),
    source: z.enum(["heuristic", "step1-refined"]),
  }).strict(),
  layoutMode: z.enum(["fixed-600x300", "free"]),
  profileContext: z.object({
    domains: z.array(safeIndex).max(30),
    retrievalKeys: z.array(safeIndex).max(60),
  }).strict(),
  modelProfile: modelSchema,
}).strict();

const SYSTEM_PROMPT = `You convert a concrete generative-UI request into a reusable task invocation.
Separate the invariant task from values that can change between runs. For example, "去北京旅游" becomes intentKey "travel_planning", displayName "旅游", and parameter destination="北京".
intentKey and parameter keys must be stable English snake_case. Keep every explicit constraint; do not invent missing values.
Parameters contain only values explicitly present in the current query. Profile domains are an index catalog, not evidence and must never become parameter values.
Use the user's language for displayName, invariantSummary, labels and constraints.
Do not output chain-of-thought, hidden reasoning, URLs, instructions, tools, or prose outside JSON.
Return exactly this JSON shape:
{"formatVersion":"genui-query-abstraction/1","intentKey":"snake_case","displayName":"short label","invariantSummary":"reusable goal without concrete values","invariantTerms":["generic term"],"parameters":[{"key":"snake_case","label":"short label","valueKind":"location|date|number|enum|entity|text","value":"explicit query value","source":"query","confidence":0.0}],"constraints":["explicit reusable constraint"],"confidence":0.0}.`;

function completionParams(modelProfile: ExternalSkillMatcherModel, body: z.infer<typeof requestSchema>) {
  const target = resolveModelProfile(modelProfile);
  return {
    target,
    params: {
      model: target.model,
      messages: [
        { role: "system" as const, content: SYSTEM_PROMPT },
        { role: "user" as const, content: JSON.stringify({
          query: body.query,
          coarseClassification: body.classification,
          layoutMode: body.layoutMode,
          profileIndexCatalog: body.profileContext,
        }) },
      ],
      response_format: { type: "json_object" as const },
      temperature: 0,
      ...(target.provider === "glm" ? { thinking: { type: "disabled" }, do_sample: false } : {}),
      ...(target.provider === "groq" ? { reasoning_effort: "none" } : {}),
    } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
  };
}

export async function POST(request: Request) {
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 }); }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "任务抽象请求不合法", issues: parsed.error.issues.slice(0, 8) }, { status: 400 });
  const body = parsed.data;
  if (!canCallModelProfile(body.modelProfile)) {
    return Response.json({
      error: body.modelProfile === "groq_qwen_3_6_27b" ? "任务抽象需要 GROQ_API_KEY" : "任务抽象需要 LLM_API_KEY",
      code: "abstraction_model_unconfigured",
    }, { status: 503 });
  }
  const started = Date.now();
  try {
    const { target, params } = completionParams(body.modelProfile, body);
    const completion = await createLLMClient(target.provider).chat.completions.create(params, { signal: AbortSignal.timeout(45_000) });
    const abstraction = validateQueryAbstraction(extractJson(completion.choices[0]?.message?.content ?? ""));
    return Response.json({
      abstraction,
      model: completion.model || target.model,
      modelProfile: body.modelProfile,
      durationMs: Date.now() - started,
      usage: completion.usage ? {
        prompt: completion.usage.prompt_tokens ?? 0,
        completion: completion.usage.completion_tokens ?? 0,
        total: completion.usage.total_tokens ?? 0,
      } : undefined,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "任务抽象失败",
      code: "query_abstraction_failed",
      durationMs: Date.now() - started,
    }, { status: 502 });
  }
}
