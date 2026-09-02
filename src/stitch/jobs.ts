import "server-only";

import type { StitchJobProgress } from "./types";

const MAX_BODY_BYTES = 256 * 1024;

function executorConfig() {
  const url = process.env.STITCH_EXECUTOR_URL?.trim().replace(/\/$/, "");
  const secret = process.env.STITCH_EXECUTOR_SECRET?.trim();
  if (!url || !secret) throw new Error("Stitch 异步执行器尚未配置");
  return { url, secret };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function callStitchExecutor(path: string, init: { method: "POST" | "GET" | "DELETE"; body?: unknown }): Promise<Response> {
  const { url, secret } = executorConfig();
  const body = init.body === undefined ? "" : JSON.stringify(init.body);
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error("Stitch 任务请求过大");
  const timestamp = Date.now().toString();
  const canonical = `${timestamp}\n${init.method}\n${path}\n${await sha256Hex(body)}`;
  return fetch(`${url}${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      "X-GenUI-Timestamp": timestamp,
      "X-GenUI-Signature": await hmacHex(secret, canonical),
    },
    body: body || undefined,
    cache: "no-store",
  });
}

export async function executorJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; }
  catch { throw new Error(`Stitch 执行器返回无效响应（HTTP ${response.status}）`); }
}

export function isStitchJobProgress(value: unknown): value is StitchJobProgress {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StitchJobProgress>;
  return typeof item.jobId === "string" && typeof item.status === "string" && typeof item.phase === "string" && typeof item.elapsedMs === "number";
}
