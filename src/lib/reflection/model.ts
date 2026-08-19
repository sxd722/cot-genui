import "server-only";
import OpenAI from "openai";
import { createLLMClient, extractJson } from "@/lib/llm";
import { resolveModelProfile } from "@/lib/modelProfiles";
import { nvidiaChatOptions } from "@/lib/nvidia";
import { REFLECTION_MODEL_PROFILE } from "./config";

export async function callReflectionJson(system: string, user: unknown): Promise<unknown> {
  const target = resolveModelProfile(REFLECTION_MODEL_PROFILE);
  const client = createLLMClient(target.provider);
  const params = {
    model: target.model,
    messages: [{ role: "system" as const, content: system }, { role: "user" as const, content: JSON.stringify(user) }],
    temperature: 0.1,
    response_format: { type: "json_object" as const },
    ...(target.provider === "glm" ? { thinking: { type: target.thinking ? "enabled" : "disabled" }, do_sample: true, ...(target.thinking ? { reasoning_effort: "high" } : {}) } : {}),
    ...(target.provider === "groq" ? { reasoning_effort: target.groqReasoningEffort ?? "none", ...(target.includeReasoning !== undefined ? { include_reasoning: target.includeReasoning } : {}) } : {}),
    ...(target.provider === "nvidia" ? nvidiaChatOptions(target.thinking) : {}),
  } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming;
  const completion = await client.chat.completions.create(params);
  return extractJson(completion.choices[0]?.message?.content ?? "");
}
