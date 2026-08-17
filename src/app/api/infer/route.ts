import { NextResponse } from "next/server";
import { PIPELINE_STEPS, runPipelineStep, type PipelineStepName } from "@/lib/pipeline";
import type { CallLog } from "@/lib/llm";
import type { CardPlan } from "@/dsl/modules";
import { MODEL_PROFILES, type InferenceState, type ModelProfile } from "@/lib/pipelineTypes";
import type { ProfileDigest } from "@/lib/profileTypes";

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
  try {
    const output = await runPipelineStep({
      name: body.step,
      query: body.query,
      deviceContext: body.deviceContext as Record<string, unknown>,
      inferenceState: body.inferenceState as InferenceState | undefined,
      userAnswers: body.userAnswers as Record<number, string> | undefined,
      cardPlan: body.cardPlan as CardPlan | undefined,
      profileDigest: body.profileDigest as ProfileDigest | undefined,
      modelProfile: isModelProfile(body.modelProfile) ? body.modelProfile : undefined,
      prefetchedSearch: body.prefetchedSearch as { searchQuery: string; webSearchRaw: unknown } | undefined,
      mock: !process.env.LLM_API_KEY,
      onLog: (entry) => logs.push(entry),
    });
    return NextResponse.json({ ...output, _mock: !process.env.LLM_API_KEY, _logs: logs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "推理失败", _logs: logs },
      { status: 500 },
    );
  }
}
