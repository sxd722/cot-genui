import "server-only";
import OpenAI from "openai";
import { NVIDIA_BUILD_BASE_URL } from "@/lib/nvidia";

export type LLMProvider = "glm" | "groq" | "hf_community" | "nvidia";

const HF_COMMUNITY_BASE_URL = "https://g9hnto0u7lvbu837.us-east-2.aws.endpoints.huggingface.cloud/v1";

export interface LLMTarget {
  provider: LLMProvider;
  model: string;
}

/* ------------------------------------------------------------------ */
/*  LLM 客户端                                                         */
/*  六步推理在 src/lib/pipeline.ts；画像在 src/lib/profile.ts。         */
/*  这里只保留共享的客户端、JSON 容错解析和调用日志类型。               */
/* ------------------------------------------------------------------ */

export function createLLMClient(provider: LLMProvider = "glm"): OpenAI {
  const apiKey = provider === "hf_community"
    ? "none"
    : provider === "groq"
      ? process.env.GROQ_API_KEY
      : provider === "nvidia"
        ? process.env.NVIDIA_API_KEY
        : process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      provider === "groq"
        ? "缺少 GROQ_API_KEY 环境变量。请在 .env.local 中配置。"
        : provider === "nvidia"
          ? "缺少 NVIDIA_API_KEY 环境变量。请在本地环境文件中配置。"
        : "缺少 LLM_API_KEY 环境变量。请在 .env.local 中配置（可指向 OpenAI/GLM 等兼容端点）。",
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: provider === "hf_community"
      ? (process.env.HF_COMMUNITY_BASE_URL ?? HF_COMMUNITY_BASE_URL)
      : provider === "groq"
        ? (process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1")
        : provider === "nvidia"
          ? (process.env.NVIDIA_BASE_URL ?? NVIDIA_BUILD_BASE_URL)
          : process.env.LLM_BASE_URL,
    ...(provider === "hf_community" || provider === "nvidia"
      ? {
          timeout: Math.max(
            10_000,
            Number(provider === "nvidia" ? process.env.NVIDIA_TIMEOUT_MS : process.env.HF_COMMUNITY_TIMEOUT_MS) || 120_000,
          ),
          maxRetries: 0,
        }
      : {}),
  });
}

export function hasAnyLLMKey(): boolean {
  return !!(process.env.GROQ_API_KEY || process.env.LLM_API_KEY || process.env.NVIDIA_API_KEY);
}

export function defaultLLMTarget(): LLMTarget {
  if (process.env.GROQ_API_KEY) {
    return { provider: "groq", model: process.env.GROQ_MODEL ?? "qwen/qwen3.6-27b" };
  }
  return { provider: "glm", model: process.env.LLM_MODEL ?? "glm-5.2" };
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
