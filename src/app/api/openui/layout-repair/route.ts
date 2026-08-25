import type OpenAI from "openai";
import { createLLMClient } from "@/lib/llm";
import { canCallModelProfile, resolveModelProfile } from "@/lib/modelProfiles";
import { MODEL_PROFILES, type ModelProfile } from "@/lib/pipelineTypes";
import { nvidiaChatOptions } from "@/lib/nvidia";
import type { CardPlan } from "@/dsl/modules";
import { buildOpenUIDesignBrief } from "@/openui/designBrief";
import { buildDeterministicFixedOpenUI } from "@/openui/fixedArtifact";
import { extractCardSlice, mergeOpenUIPatch } from "@/openui/editSlice";
import { fixedOpenUILayoutPrompt } from "@/openui/layoutPolicy";
import type { OpenUILayoutMeasurement, OpenUILayoutRepairRequest, OpenUILayoutRepairResponse } from "@/openui/layoutRuntime";
import { isAssignmentStatement, referencedStatementIds, splitOpenUIStatements } from "@/openui/statements";
import { normalizeOpenUIOutput, openUISystemPromptFor, validateOpenUIArtifact } from "@/lib/openui";

export const runtime = "nodejs";

function isCardPlan(value: unknown): value is CardPlan {
  return !!value && typeof value === "object" && Array.isArray((value as Partial<CardPlan>).cards)
    && (value as CardPlan).cards.every((card) => !!card && typeof card.id === "string");
}

function isMeasurement(value: unknown): value is OpenUILayoutMeasurement {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OpenUILayoutMeasurement>;
  return typeof item.cardId === "string" && typeof item.clientHeight === "number" && typeof item.scrollHeight === "number"
    && typeof item.bodyClientHeight === "number" && typeof item.bodyScrollHeight === "number"
    && typeof item.headerClientHeight === "number" && typeof item.headerScrollHeight === "number" && item.overflowing === true;
}

function validateRequest(value: unknown): OpenUILayoutRepairRequest | string {
  if (!value || typeof value !== "object") return "请求体不是对象";
  const body = value as Partial<OpenUILayoutRepairRequest>;
  if (typeof body.currentCode !== "string" || !body.currentCode.trim() || body.currentCode.length > 200_000) return "currentCode 缺失或过长";
  if (!isCardPlan(body.cardPlan) || body.cardPlan.layoutPolicy?.mode !== "fixed-600x300") return "只接受 fixed-600x300 CardPlan";
  if (body.assetManifest !== undefined && (!body.assetManifest || typeof body.assetManifest !== "object"
    || !Array.isArray(body.assetManifest.requests) || !Array.isArray(body.assetManifest.assets))) return "assetManifest 无效";
  if (!Array.isArray(body.measurements) || !body.measurements.length || body.measurements.length > 20 || !body.measurements.every(isMeasurement)) return "缺少合法的溢出测量";
  if (!MODEL_PROFILES.includes(body.modelProfile as ModelProfile)) return "modelProfile 无效";
  const ids = new Set(body.cardPlan.cards.map((card) => card.id));
  if (body.measurements.some((item) => !ids.has(item.cardId))) return "测量包含 CardPlan 之外的 cardId";
  return body as OpenUILayoutRepairRequest;
}

function fallback(body: OpenUILayoutRepairRequest, error?: string): OpenUILayoutRepairResponse {
  return {
    code: buildDeterministicFixedOpenUI(body.cardPlan, body.assetManifest),
    strategy: "deterministic-fallback",
    repairedCardIds: body.measurements.map((item) => item.cardId),
    error,
  };
}

function completionText(completion: OpenAI.Chat.Completions.ChatCompletion): string {
  const content = completion.choices[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

export async function POST(request: Request) {
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 }); }
  const validated = validateRequest(raw);
  if (typeof validated === "string") return Response.json({ error: validated }, { status: 400 });
  const body = validated;
  if (!canCallModelProfile(body.modelProfile)) {
    try { return Response.json(fallback(body, "布局修复模型不可用")); }
    catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "确定性布局失败" }, { status: 422 });
    }
  }

  try {
    const targetIndexes = body.measurements.map((measurement) => body.cardPlan.cards.findIndex((card) => card.id === measurement.cardId));
    const slices = targetIndexes.map((index) => extractCardSlice(body.currentCode, index));
    const editableIds = new Set(slices.flatMap((slice) => slice.editableIds));
    const allowedReferences = new Set(slices.flatMap((slice) => slice.statementIds));
    const knownIds = new Set(splitOpenUIStatements(body.currentCode).filter(isAssignmentStatement).map((statement) => statement.id));
    const brief = buildOpenUIDesignBrief(body.cardPlan, body.assetManifest);
    const target = resolveModelProfile(body.modelProfile);
    const promptRoute = openUISystemPromptFor({ taskFamily: "general", modelProfile: body.modelProfile, layoutMode: "fixed-600x300" });
    const user = {
      task: "Rewrite only the supplied overflowing card dependency slices. Return assignment statements for editable IDs only; do not return the shell or unrelated cards.",
      targetCards: body.measurements.map((measurement, index) => ({
        measurement,
        designBrief: brief.cards.find((card) => card.id === measurement.cardId),
        bodyRef: slices[index].bodyRef,
        editableIds: slices[index].editableIds,
        currentSlice: slices[index].source,
      })),
    };
    const client = createLLMClient(target.provider);
    const completion = await client.chat.completions.create({
      model: target.model,
      messages: [
        { role: "system", content: `${promptRoute.prompt}\n\n${fixedOpenUILayoutPrompt("fixed-600x300")}\n\nThis is a bounded layout repair. Preserve every supplied fact, actionRef and assetRef. Return only target assignment statements.` },
        { role: "user", content: JSON.stringify(user) },
      ],
      temperature: 0,
      stream: false,
      ...(target.provider === "glm" ? { thinking: { type: "disabled" }, do_sample: false } : {}),
      ...(target.provider === "groq" ? { reasoning_effort: "none", include_reasoning: false } : {}),
      ...(target.provider === "nvidia" ? nvidiaChatOptions(false) : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    const patch = normalizeOpenUIOutput(completionText(completion));
    for (const statement of splitOpenUIStatements(patch)) {
      if (!isAssignmentStatement(statement)) throw new Error("layout patch 包含非 assignment 内容");
      const illegal = referencedStatementIds(statement, knownIds).find((id) => !allowedReferences.has(id));
      if (illegal) throw new Error(`layout patch 越界引用：${illegal}`);
    }
    const code = mergeOpenUIPatch(body.currentCode, patch, editableIds);
    const validation = validateOpenUIArtifact(code, body.cardPlan, body.assetManifest, brief);
    if (!validation.valid) throw new Error(`layout patch 校验失败：${validation.errors.join("；")}`);
    return Response.json({
      code, strategy: "model-repair", repairedCardIds: body.measurements.map((item) => item.cardId),
      validation, model: completion.model,
    } satisfies OpenUILayoutRepairResponse);
  } catch (error) {
    try { return Response.json(fallback(body, error instanceof Error ? error.message : "布局修复失败")); }
    catch (fallbackError) {
      return Response.json({ error: fallbackError instanceof Error ? fallbackError.message : "布局修复与确定性 fallback 均失败" }, { status: 422 });
    }
  }
}
