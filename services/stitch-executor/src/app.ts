import express, { type NextFunction, type Request, type Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { hmac, sha256, verifyHmac } from "./security.js";
import type { ArtifactStore, JobRecord, JobStore, PublicJob, StitchGenerator, TaskQueue } from "./types.js";

export interface Dependencies {
  jobs: JobStore;
  artifacts: ArtifactStore;
  queue: TaskQueue;
  generator: StitchGenerator;
  executorSecret: string;
  readTokenSecret: string;
  verifyTask?: (request: Request) => Promise<boolean>;
  now?: () => number;
}

function rawBody(request: Request) { return Buffer.isBuffer(request.body) ? request.body.toString("utf8") : JSON.stringify(request.body ?? {}); }
function publicToken(secret: string, jobId: string) { return hmac(secret, `read:${jobId}`); }
function tokenHash(value: string) { return sha256(`token:${value}`); }

function responseFor(record: JobRecord, htmlSource?: string): PublicJob {
  const started = Date.parse(record.startedAt ?? record.createdAt);
  const ended = record.completedAt ? Date.parse(record.completedAt) : Date.now();
  return {
    jobId: record.id, status: record.status, phase: record.phase, createdAt: record.createdAt, updatedAt: record.updatedAt,
    elapsedMs: Math.max(0, ended - started), pollAfterMs: record.status === "running" ? 2_500 : 1_500,
    ...(record.status === "succeeded" && htmlSource !== undefined ? { artifact: {
      provider: "stitch", projectId: record.projectId ?? "", screenId: record.screenId ?? "", model: record.model,
      htmlSource, htmlBytes: record.htmlBytes ?? Buffer.byteLength(htmlSource), durationMs: record.durationMs ?? Math.max(0, ended - started),
    } } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

export function createApp(deps: Dependencies) {
  const app = express();
  const now = deps.now ?? Date.now;
  app.use(express.json({ limit: "300kb", verify: (request, _response, buffer) => { (request as Request & { rawBody?: string }).rawBody = buffer.toString("utf8"); } }));

  const signed = (request: Request, response: Response, next: NextFunction) => {
    const timestamp = request.header("X-GenUI-Timestamp") ?? "";
    const signature = request.header("X-GenUI-Signature") ?? "";
    const body = (request as Request & { rawBody?: string }).rawBody ?? (request.method === "GET" || request.method === "DELETE" ? "" : rawBody(request));
    if (!verifyHmac(deps.executorSecret, timestamp, signature, request.method, request.originalUrl, body)) return response.status(401).json({ error: "Invalid executor signature" });
    next();
  };

  const taskAuth = deps.verifyTask ?? (async (request: Request) => {
    const token = request.header("authorization")?.replace(/^Bearer\s+/i, "");
    const audience = process.env.STITCH_EXECUTOR_PUBLIC_URL;
    if (!token || !audience) return false;
    await new OAuth2Client().verifyIdToken({ idToken: token, audience });
    return true;
  });

  app.get("/healthz", (_request, response) => response.json({ ok: true }));
  app.post("/v1/jobs", signed, async (request, response) => {
    const prompt = typeof request.body?.prompt === "string" ? request.body.prompt : "";
    const idempotencyKey = typeof request.body?.idempotencyKey === "string" ? request.body.idempotencyKey : "";
    if (!prompt || !idempotencyKey || prompt.length > 200_000) return response.status(400).json({ error: "Invalid prompt or idempotencyKey" });
    const requestHash = sha256(prompt);
    const id = `stj_${sha256(`${idempotencyKey}:${requestHash}`).slice(0, 32)}`;
    const readToken = publicToken(deps.readTokenSecret, id);
    const timestamp = new Date(now()).toISOString();
    const record: JobRecord = {
      id, requestHash, prompt, readTokenHash: tokenHash(readToken), status: "queued", phase: "queued",
      createdAt: timestamp, updatedAt: timestamp, expiresAt: new Date(now() + 24 * 60 * 60_000).toISOString(),
      model: process.env.STITCH_MODEL_ID || "GEMINI_3_FLASH", attempts: 0,
    };
    const result = await deps.jobs.create(record);
    if (result.record.requestHash !== requestHash) return response.status(409).json({ error: "Idempotency key conflict" });
    if (result.created) {
      try { await deps.queue.enqueue(id); }
      catch (error) {
        await deps.jobs.patch(id, { status: "failed", phase: "complete", updatedAt: new Date(now()).toISOString(), error: { code: "queue_error", message: error instanceof Error ? error.message : "Queue failed" } });
        return response.status(503).json({ error: "Failed to enqueue Stitch job" });
      }
    }
    return response.status(202).json({ jobId: id, readToken, status: result.record.status, pollAfterMs: 1_500 });
  });

  app.get("/v1/jobs/:jobId", signed, async (request, response) => {
    const jobId = String(request.params.jobId);
    const record = await deps.jobs.get(jobId);
    if (!record || tokenHash(String(request.query.token ?? "")) !== record.readTokenHash) return response.status(404).json({ error: "Job not found" });
    if (Date.parse(record.expiresAt) <= now()) return response.status(410).json(responseFor({ ...record, status: "expired", phase: "complete" }));
    const html = record.status === "succeeded" && record.artifactPath ? await deps.artifacts.get(record.artifactPath) : undefined;
    return response.json(responseFor(record, html));
  });

  app.delete("/v1/jobs/:jobId", signed, async (request, response) => {
    const jobId = String(request.params.jobId);
    const record = await deps.jobs.get(jobId);
    if (!record || tokenHash(String(request.query.token ?? "")) !== record.readTokenHash) return response.status(404).json({ error: "Job not found" });
    if (["succeeded", "failed", "expired"].includes(record.status)) return response.status(409).json({ error: "Job is already terminal" });
    const timestamp = new Date(now()).toISOString();
    const canceled = await deps.jobs.patch(record.id, { status: "canceled", phase: "complete", canceledAt: timestamp, updatedAt: timestamp, prompt: "" });
    return response.json(responseFor(canceled));
  });

  app.post("/internal/jobs/:jobId/execute", async (request, response) => {
    if (!await taskAuth(request)) return response.status(401).json({ error: "Invalid task identity" });
    const jobId = String(request.params.jobId);
    const record = await deps.jobs.get(jobId);
    if (!record) return response.status(404).json({ error: "Job not found" });
    if (["succeeded", "canceled", "expired"].includes(record.status) || (record.status === "failed" && record.attempts >= 2)) return response.json({ status: record.status });
    if (record.status === "running") return response.status(202).json({ status: "running" });
    const startedAt = new Date(now()).toISOString();
    const attempt = record.attempts + 1;
    await deps.jobs.patch(record.id, { status: "running", phase: "generating", attempts: attempt, startedAt, updatedAt: startedAt });
    try {
      const generated = await deps.generator.generate(record.prompt, record.model, async (phase) => {
        await deps.jobs.patch(record.id, { phase, updatedAt: new Date(now()).toISOString() });
      });
      await deps.jobs.patch(record.id, { phase: "finalizing", projectId: generated.projectId, screenId: generated.screenId, updatedAt: new Date(now()).toISOString() });
      const current = await deps.jobs.get(record.id);
      if (current?.status === "canceled") return response.json({ status: "canceled" });
      const artifactPath = await deps.artifacts.put(record.id, generated.html);
      const completedAt = new Date(now()).toISOString();
      await deps.jobs.patch(record.id, {
        status: "succeeded", phase: "complete", artifactPath, htmlBytes: generated.htmlBytes,
        durationMs: Math.max(0, now() - Date.parse(startedAt)), completedAt, updatedAt: completedAt,
        prompt: "",
      });
      return response.json({ status: "succeeded" });
    } catch (error) {
      const completedAt = new Date(now()).toISOString();
      const finalAttempt = attempt >= 2;
      await deps.jobs.patch(record.id, {
        status: finalAttempt ? "failed" : "queued", phase: finalAttempt ? "complete" : "queued",
        updatedAt: completedAt, prompt: finalAttempt ? "" : record.prompt,
        error: { code: "stitch_generation_failed", message: error instanceof Error ? error.message : "Stitch generation failed" },
        ...(finalAttempt ? { completedAt } : {}),
      });
      return response.status(500).json({ status: "failed" });
    }
  });
  return app;
}
