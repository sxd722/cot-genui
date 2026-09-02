import type { StitchArtifact, StitchJobAccepted, StitchJobProgress } from "./types";
import { isStitchArtifact } from "./types";

const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);

function parseObject(text: string): Record<string, unknown> {
  try {
    const value = text ? JSON.parse(text) : null;
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export async function createStitchJob(input: { cardPlan: unknown; query: string; idempotencyKey: string }): Promise<StitchJobAccepted> {
  const response = await fetch("/api/stitch/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = parseObject(await response.text());
  if (!response.ok || typeof payload.jobId !== "string" || typeof payload.readToken !== "string") {
    throw new Error(String(payload.error ?? `Stitch 任务创建失败（HTTP ${response.status}）`));
  }
  return { jobId: payload.jobId, readToken: payload.readToken, status: "queued", pollAfterMs: Number(payload.pollAfterMs) || 1_500 };
}

export async function readStitchJob(jobId: string, readToken: string): Promise<StitchJobProgress> {
  const response = await fetch(`/api/stitch/jobs/${encodeURIComponent(jobId)}?token=${encodeURIComponent(readToken)}`, { cache: "no-store" });
  const payload = parseObject(await response.text());
  if (!response.ok) throw new Error(String(payload.error ?? `读取 Stitch 任务失败（HTTP ${response.status}）`));
  return payload as unknown as StitchJobProgress;
}

export async function cancelStitchJob(jobId: string, readToken: string): Promise<void> {
  const response = await fetch(`/api/stitch/jobs/${encodeURIComponent(jobId)}?token=${encodeURIComponent(readToken)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 409) {
    const payload = parseObject(await response.text());
    throw new Error(String(payload.error ?? "取消 Stitch 任务失败"));
  }
}

export async function generateStitchSynchronously(cardPlan: unknown, query: string): Promise<StitchArtifact> {
  const response = await fetch("/api/stitch/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardPlan, query }) });
  const payload = parseObject(await response.text());
  if (!response.ok || !isStitchArtifact(payload)) throw new Error(String(payload.error ?? `Stitch 同步兜底失败（HTTP ${response.status}）`));
  return payload;
}

export async function pollStitchJob(input: {
  jobId: string;
  readToken: string;
  onProgress: (progress: StitchJobProgress) => void;
  maxDurationMs?: number;
}): Promise<StitchArtifact> {
  const startedAt = Date.now();
  let delay = 1_500;
  while (Date.now() - startedAt < (input.maxDurationMs ?? 10 * 60_000)) {
    const progress = await readStitchJob(input.jobId, input.readToken);
    input.onProgress(progress);
    if (TERMINAL.has(progress.status)) {
      if (progress.status === "succeeded" && isStitchArtifact(progress.artifact)) return progress.artifact;
      throw new Error(progress.error?.message ?? `Stitch 任务已${progress.status === "canceled" ? "取消" : "失败"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(delay, progress.pollAfterMs || 0)));
    delay = Math.min(5_000, delay + 1_000);
  }
  throw new Error("Stitch 任务等待超过 10 分钟；任务记录已保留，可刷新页面继续查看");
}
