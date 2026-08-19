import { NextResponse } from "next/server";
import { PIPELINE_STEPS, runPipelineStep, type PipelineStepName } from "@/lib/pipeline";
import type { CallLog } from "@/lib/llm";
import type { CardPlan } from "@/dsl/modules";
import { MODEL_PROFILES, type InferenceState, type ModelProfile } from "@/lib/pipelineTypes";
import type { ProfileDigest } from "@/lib/profileTypes";
import { classifyQuery, isQueryClassification } from "@/lib/adaptive/classification";
import { resolveEffectivePolicy } from "@/lib/adaptive/policy";
import { sanitizeAdaptiveContext } from "@/lib/adaptive/validation";
import { canCallModelProfile } from "@/lib/modelProfiles";

const isStepName = (value: string): value is PipelineStepName =>
  (PIPELINE_STEPS as readonly string[]).includes(value);

const isModelProfile = (value: unknown): value is ModelProfile =>
  typeof value === "string" && (MODEL_PROFILES as readonly string[]).includes(value);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (typeof body.query !== "string" || !body.query.trim()) {
    return NextResponse.json({ error: "缺少 query" }, { status: 400 });
  }
  if (!body.deviceContext || typeof body.deviceContext !== "object") {
    return NextResponse.json({ error: "缺少 deviceContext" }, { status: 400 });
  }
  if (typeof body.step !== "string" || !isStepName(body.step)) {
    return NextResponse.json({ error: "缺少或不支持 step" }, { status: 400 });
  }

  const logs: CallLog[] = [];
  const modelProfile = isModelProfile(body.modelProfile) ? body.modelProfile : "groq_qwen_3_6_27b";
  const classification = isQueryClassification(body.classification) ? body.classification : classifyQuery(body.query);
  const fallbackAdaptiveContext = resolveEffectivePolicy({
    classification,
    stablePolicies: [],
    step: body.step as PipelineStepName,
  });
  const adaptiveContext = sanitizeAdaptiveContext(body.adaptiveContext, classification) ?? fallbackAdaptiveContext;
  const isMock = !canCallModelProfile(modelProfile);
  const run = (onStreamDelta?: (delta: string, cumulativeChars: number) => void) => runPipelineStep({
    name: body.step as PipelineStepName,
    query: body.query as string,
    deviceContext: body.deviceContext as Record<string, unknown>,
    inferenceState: body.inferenceState as InferenceState | undefined,
    userAnswers: body.userAnswers as Record<number, string> | undefined,
    cardPlan: body.cardPlan as CardPlan | undefined,
    profileDigest: body.profileDigest as ProfileDigest | undefined,
    profileSourceText: body.step === "intent_analysis" && typeof body.profileSourceText === "string"
      ? body.profileSourceText.slice(0, 100_000)
      : undefined,
    classification,
    adaptiveContext,
    modelProfile,
    prefetchedSearch: body.prefetchedSearch as { searchQuery: string; webSearchRaw: unknown } | undefined,
    stream: body.step === "openui_generate" && body.stream === true,
    onStreamDelta,
    mock: isMock,
    onLog: (entry) => logs.push(entry),
  });

  if (body.step === "openui_generate" && body.stream === true) {
    const encoder = new TextEncoder();
    const encodeEvent = (event: string, data: unknown) =>
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let clientCanceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: string, data: unknown) => {
          if (clientCanceled) return;
          try {
            controller.enqueue(encodeEvent(event, data));
          } catch {
            clientCanceled = true;
          }
        };
        void (async () => {
          try {
            const output = await run((delta, cumulativeChars) => {
              emit("delta", { delta, chars: cumulativeChars });
            });
            emit("done", { ...output, _mock: isMock, _logs: logs });
          } catch (error) {
            emit("error", {
              error: error instanceof Error ? error.message : "推理失败",
              _logs: logs,
            });
          } finally {
            if (!clientCanceled) controller.close();
          }
        })();
      },
      cancel() {
        clientCanceled = true;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  try {
    const output = await run();
    return NextResponse.json({ ...output, _mock: isMock, _logs: logs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "推理失败", _logs: logs },
      { status: 500 },
    );
  }
}
