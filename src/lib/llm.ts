import "server-only";
import OpenAI from "openai";

/* ------------------------------------------------------------------ */
/*  LLM 客户端                                                         */
/*  六步推理在 src/lib/pipeline.ts；画像在 src/lib/profile.ts。         */
/*  这里只保留共享的客户端、JSON 容错解析和调用日志类型。               */
/* ------------------------------------------------------------------ */

export function createLLMClient(): OpenAI {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少 LLM_API_KEY 环境变量。请在 .env.local 中配置（可指向 OpenAI/GLM 等兼容端点）。",
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.LLM_BASE_URL,
  });
}

/**
 * JSON 提取容错。
 * 很多兼容端点（GLM 等）即使指定了 response_format，仍会用 ```json ... ```
 * 围栏包裹输出。这里统一做剥离 + 容错解析。
 */
export function extractJson(text: string): unknown {
  if (!text) throw new Error("模型返回空内容");
  let s = text.trim();

  // 1) 去除 markdown 代码围栏 ```json ... ``` 或 ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 2) 直接解析
  try {
    return JSON.parse(s);
  } catch {
    // 3) 截取第一个 { 到最后一个 } 之间
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const slice = s.slice(start, end + 1);
      return JSON.parse(slice);
    }
  }
  throw new Error("无法从模型输出中解析 JSON");
}

/** 模型调用日志条目（pipeline / route 共享） */
export interface CallLog {
  ts: string;
  phase: "request" | "response" | "error" | "fallback";
  message: string;
  detail?: unknown;
}
