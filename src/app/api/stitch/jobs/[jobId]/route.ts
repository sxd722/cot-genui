import { NextResponse } from "next/server";
import { callStitchExecutor, executorJson } from "@/stitch/jobs";

export const runtime = "nodejs";

type Context = { params: Promise<{ jobId: string }> };

async function proxy(request: Request, context: Context, method: "GET" | "DELETE") {
  try {
    const { jobId } = await context.params;
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(jobId)) return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (!token) return NextResponse.json({ error: "Missing read token" }, { status: 401 });
    const path = `/v1/jobs/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`;
    const response = await callStitchExecutor(path, { method });
    return NextResponse.json(await executorJson(response), { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(`[stitch:jobs:${method.toLowerCase()}]`, error);
    return NextResponse.json({ code: "stitch_executor_unavailable", error: error instanceof Error ? error.message : "Stitch 任务服务不可用" }, { status: 503 });
  }
}

export const GET = (request: Request, context: Context) => proxy(request, context, "GET");
export const DELETE = (request: Request, context: Context) => proxy(request, context, "DELETE");
