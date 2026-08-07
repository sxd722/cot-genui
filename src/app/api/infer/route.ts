import { NextResponse } from "next/server";
import {
  runStep,
  runInference,
  STEP_NAMES,
  type StepName,
  type CallLog,
  type StepOutput,
} from "@/lib/llm";
import type { InferResponse } from "@/lib/schemas";

/**
 * POST /api/infer
 *
 * 分步模式（推荐）:
 *   body: { query, deviceContext, step: "surface_parse", priorSteps: {...} }
 *   返回: { ...StepOutput, _mock }
 *
 * 全流程模式:
 *   body: { query, deviceContext }   // 不传 step
 *   返回: { ...InferResponse, _mock }
 */

const isStepName = (s: string): s is StepName =>
  (STEP_NAMES as readonly string[]).includes(s);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const query = body.query;
  const deviceContext = body.deviceContext;
  if (typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "缺少 query" }, { status: 400 });
  }
  if (!deviceContext || typeof deviceContext !== "object") {
    return NextResponse.json({ error: "缺少 deviceContext" }, { status: 400 });
  }

  const useMock = !process.env.LLM_API_KEY;
  const logs: CallLog[] = [];
  const onLog = (e: CallLog) => logs.push(e);

  try {
    // 分步模式
    if (typeof body.step === "string" && isStepName(body.step)) {
      const out: StepOutput = await runStep({
        query,
        deviceContext: deviceContext as Record<string, unknown>,
        priorSteps: (body.priorSteps as Record<string, unknown>) ?? undefined,
        userAnswers:
          (body.userAnswers as Record<number, string> | undefined) ?? undefined,
        genMode:
          (body.genMode as "ir" | "semantic" | undefined) ?? undefined,
        name: body.step,
        mock: useMock,
        onLog,
      });
      return NextResponse.json({ ...out, _mock: useMock, _logs: logs });
    }

    // 全流程模式
    const result: InferResponse = await runInference({
      query,
      deviceContext: deviceContext as Record<string, unknown>,
      mock: useMock,
      onLog,
    });
    return NextResponse.json({ ...result, _mock: useMock, _logs: logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "推理失败";
    return NextResponse.json({ error: message, _logs: logs }, { status: 500 });
  }
}
