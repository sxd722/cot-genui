import { NextResponse } from "next/server";
import { parseStitchCardPlan } from "@/stitch/cardPlan";
import { buildStitchPrompt } from "@/stitch/prompt";
import { callStitchExecutor, executorJson } from "@/stitch/jobs";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const cardPlan = isRecord(body) ? parseStitchCardPlan(body.cardPlan) : null;
    const query = isRecord(body) && typeof body.query === "string" ? body.query.slice(0, 8_000) : "";
    const idempotencyKey = isRecord(body) && typeof body.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 200) : "";
    if (!cardPlan || !idempotencyKey) return NextResponse.json({ error: "Missing CardPlan or idempotencyKey" }, { status: 400 });
    const response = await callStitchExecutor("/v1/jobs", {
      method: "POST",
      body: { prompt: buildStitchPrompt(cardPlan, query), idempotencyKey },
    });
    return NextResponse.json(await executorJson(response), { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[stitch:jobs:create]", error);
    return NextResponse.json({ code: "stitch_executor_unavailable", error: error instanceof Error ? error.message : "Stitch 任务创建失败" }, { status: 503 });
  }
}
