import { NextResponse } from "next/server";
import { runSearchPrefetch } from "@/lib/pipeline";
import { hasAnyLLMKey, type CallLog } from "@/lib/llm";
import type { InferenceState } from "@/lib/pipelineTypes";

/**
 * POST /api/prefetch-search
 * Body: { query, inferenceState }
 *
 * 暂停期投机搜索：③ 完成等待用户答题时后台调用，
 * 预取 ④ 将要执行的联网搜索。前端在继续生成时把结果带回 ④，
 * searchQuery 一致则跳过 tool 调用，直接注入 searchResults。
 */
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
  if (!body.inferenceState || typeof body.inferenceState !== "object") {
    return NextResponse.json({ error: "缺少 inferenceState" }, { status: 400 });
  }

  const logs: CallLog[] = [];
  try {
    const result = await runSearchPrefetch({
      query: body.query,
      inferenceState: body.inferenceState as InferenceState,
      mock: !hasAnyLLMKey(),
      onLog: (entry) => logs.push(entry),
    });
    return NextResponse.json({ ...result, _mock: !hasAnyLLMKey(), _logs: logs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "预取搜索失败", _logs: logs },
      { status: 500 },
    );
  }
}
