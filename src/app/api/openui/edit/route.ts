import OpenAI from "openai";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { createLLMClient } from "@/lib/llm";
import { canCallModelProfile, resolveModelProfile } from "@/lib/modelProfiles";
import { nvidiaChatOptions } from "@/lib/nvidia";
import { MODEL_PROFILES, type ModelProfile } from "@/lib/pipelineTypes";
import type { CardPlan } from "@/dsl/modules";
import type { CardEditTarget, OpenUIEditRequest } from "@/lib/cardEditingTypes";
import { normalizeOpenUIOutput, validateOpenUIArtifact } from "@/lib/openui";
import { buildOpenUIEditPrompt, extractCardMarkdownSection, OPENUI_EDIT_SYSTEM_PROMPT } from "@/openui/editPrompt";
import { extractCardSlice, mergeOpenUIPatch } from "@/openui/editSlice";
import { isAssignmentStatement, referencedStatementIds, splitOpenUIStatements } from "@/openui/statements";

export const runtime = "nodejs";

function isModelProfile(value: unknown): value is ModelProfile {
  return typeof value === "string" && (MODEL_PROFILES as readonly string[]).includes(value);
}

function isCardPlan(value: unknown): value is CardPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<CardPlan>;
  return Array.isArray(plan.cards) && plan.cards.every((card) => card && typeof card.id === "string");
}

function isTarget(value: unknown): value is CardEditTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<CardEditTarget>;
  return typeof target.cardId === "string"
    && typeof target.x === "number" && target.x >= 0 && target.x <= 1
    && typeof target.y === "number" && target.y >= 0 && target.y <= 1
    && typeof target.nearbyText === "string"
    && typeof target.elementHint === "string";
}

function errorResponse(error: string, status = 400) {
  return Response.json({ error }, { status });
}

function validateBody(value: unknown): OpenUIEditRequest | string {
  if (!value || typeof value !== "object") return "请求体不是对象";
  const body = value as Partial<OpenUIEditRequest>;
  if (typeof body.currentCode !== "string" || !body.currentCode.trim() || body.currentCode.length > 200_000) return "currentCode 缺失或过长";
  if (!isCardPlan(body.cardPlan)) return "缺少合法 CardPlan";
  if (typeof body.cardPlanMarkdown !== "string" || !body.cardPlanMarkdown.trim() || body.cardPlanMarkdown.length > 100_000) return "缺少 CardPlan Markdown";
  if (typeof body.cardId !== "string" || !body.cardId) return "缺少 cardId";
  if (!body.cardPlan.cards.some((card) => card.id === body.cardId)) return "cardId 不属于 CardPlan";
  if (!isTarget(body.target) || body.target.cardId !== body.cardId) return "缺少合法 target";
  if (typeof body.instruction !== "string" || !body.instruction.trim() || body.instruction.length > 2_000) return "编辑要求缺失或过长";
  if (!isModelProfile(body.modelProfile)) return "缺少合法 modelProfile";
  return body as OpenUIEditRequest;
}

function encodeEvent(encoder: TextEncoder, event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function completionParams(body: OpenUIEditRequest, prompt: ReturnType<typeof buildOpenUIEditPrompt>): ChatCompletionCreateParamsStreaming {
  const target = resolveModelProfile(body.modelProfile);
  return {
    model: target.model,
    messages: [
      { role: "system", content: OPENUI_EDIT_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(prompt) },
    ],
    temperature: 0.2,
    stream: true,
    stream_options: { include_usage: true },
    ...(target.provider === "glm" ? {
      thinking: { type: target.thinking ? "enabled" : "disabled" },
      do_sample: true,
    } : {}),
    ...(target.provider === "groq" ? {
      reasoning_effort: target.groqReasoningEffort ?? "none",
      ...(target.includeReasoning !== undefined ? { include_reasoning: target.includeReasoning } : {}),
    } : {}),
    ...(target.provider === "nvidia" ? nvidiaChatOptions(target.thinking) : {}),
  } as unknown as ChatCompletionCreateParamsStreaming;
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse("请求体不是合法 JSON");
  }
  const validated = validateBody(rawBody);
  if (typeof validated === "string") return errorResponse(validated);
  const body = validated;
  if (!canCallModelProfile(body.modelProfile)) return errorResponse("所选编辑模型缺少 API key", 503);

  const cardIndex = body.cardPlan.cards.findIndex((card) => card.id === body.cardId);
  let beforeSlice: ReturnType<typeof extractCardSlice>;
  let cardBrief: string;
  try {
    beforeSlice = extractCardSlice(body.currentCode, cardIndex);
    cardBrief = extractCardMarkdownSection(body.cardPlanMarkdown, cardIndex);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "无法提取目标卡片", 422);
  }
  const prompt = buildOpenUIEditPrompt({
    cardBrief,
    bodyRef: beforeSlice.bodyRef,
    editableIds: beforeSlice.editableIds,
    sharedIds: beforeSlice.sharedIds,
    currentSlice: beforeSlice.source,
    target: body.target,
    instruction: body.instruction.trim(),
  });
  const targetModel = resolveModelProfile(body.modelProfile);
  const client = createLLMClient(targetModel.provider);
  const encoder = new TextEncoder();
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: string, data: unknown) => {
        if (canceled) return;
        try { controller.enqueue(encodeEvent(encoder, event, data)); }
        catch { canceled = true; }
      };
      void (async () => {
        try {
          const completion = await client.chat.completions.create(completionParams(body, prompt));
          let rawPatch = "";
          let responseModel = targetModel.model;
          let usage: OpenAI.CompletionUsage | undefined;
          for await (const rawChunk of completion) {
            const chunk = rawChunk as typeof rawChunk & { usage?: OpenAI.CompletionUsage | null };
            const delta = chunk.choices[0]?.delta?.content;
            if (typeof delta === "string" && delta.length) {
              rawPatch += delta;
              emit("delta", { delta, chars: rawPatch.length });
            }
            if (chunk.model) responseModel = chunk.model;
            if (chunk.usage) usage = chunk.usage;
          }
          const patch = normalizeOpenUIOutput(rawPatch);
          const currentStatements = splitOpenUIStatements(body.currentCode).filter(isAssignmentStatement);
          const knownIds = new Set(currentStatements.map((statement) => statement.id));
          const allowedReferences = new Set([...beforeSlice.statementIds]);
          for (const statement of splitOpenUIStatements(patch)) {
            if (!isAssignmentStatement(statement)) throw new Error("patch 包含非 assignment 内容");
            const illegalRef = referencedStatementIds(statement, knownIds).find((id) => !allowedReferences.has(id));
            if (illegalRef) throw new Error(`patch 引用了目标卡片之外的 statement：${illegalRef}`);
          }
          const mergedCode = mergeOpenUIPatch(body.currentCode, patch, new Set(beforeSlice.editableIds));
          const validation = validateOpenUIArtifact(mergedCode, body.cardPlan);
          if (!validation.valid) throw new Error(`合并后 OpenUI 校验失败：${validation.errors.join("；")}`);
          const afterSlice = extractCardSlice(mergedCode, cardIndex);
          emit("done", {
            patch,
            code: mergedCode,
            beforeSlice: beforeSlice.source,
            afterSlice: afterSlice.source,
            validation,
            model: responseModel,
            usage,
          });
        } catch (error) {
          emit("error", { error: error instanceof Error ? error.message : "卡片编辑失败" });
        } finally {
          if (!canceled) controller.close();
        }
      })();
    },
    cancel() { canceled = true; },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

