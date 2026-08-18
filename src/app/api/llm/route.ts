import { NextResponse } from "next/server";
import { createLLMClient, defaultLLMTarget, hasAnyLLMKey } from "@/lib/llm";

/**
 * POST /api/llm
 * Body: { prompt: string }
 *
 * 简单的 LLM 文本生成端点，供卡片内 LLM 调用使用。
 */
export async function POST(request: Request) {
  let body: { prompt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const { prompt } = body;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "缺少 prompt" }, { status: 400 });
  }

  // 无 API key 时返回 mock
  if (!hasAnyLLMKey()) {
    return NextResponse.json({
      text: "（mock）当前为模拟回复。配置 GROQ_API_KEY 或 LLM_API_KEY 后将调用真实模型。",
    });
  }

  try {
    const target = defaultLLMTarget();
    const client = createLLMClient(target.provider);
    const completion = await client.chat.completions.create({
      model: target.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      ...(target.provider === "groq" ? { reasoning_effort: "none" } : {}),
    });
    const text = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "LLM 调用失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
