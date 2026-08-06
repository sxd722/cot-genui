import { NextResponse } from "next/server";
import { createLLMClient } from "@/lib/llm";

/**
 * POST /api/search
 * Body: { query: string }
 *
 * 用于 missingInfo 补齐的"web 搜索"——通过 LLM 知识问答获取外部客观信息。
 * 适用于：实时数据（股价/天气/汇率）、政策信息（利率/首付比例）、
 * 公开事实（景点门票/营业时间）等。
 *
 * 注意：LLM 知识有截止日期，无法保证实时性。
 * 生产环境应接入真实搜索 API（如 Tavily/SerpAPI）。
 */
export async function POST(request: Request) {
  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const { query } = body;
  if (typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "缺少 query" }, { status: 400 });
  }

  // 无 API key 时返回 mock
  if (!process.env.LLM_API_KEY) {
    return NextResponse.json({
      text: `（mock）搜索「${query}」的模拟结果。配置 LLM_API_KEY 后将调用真实模型。`,
    });
  }

  try {
    const client = createLLMClient();
    const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是一个实时信息查询助手。用户会询问客观事实/数据。请基于你的知识给出简洁、准确的回答。" +
            "如果信息有时效性（如股价、利率），明确标注'数据截止日期'或'请以实时查询为准'。" +
            "回答控制在 3-5 句话内，直接给结果，不要开场白。",
        },
        { role: "user", content: query },
      ],
      max_tokens: 300,
    });
    const text = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "搜索失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
