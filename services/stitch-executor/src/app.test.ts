import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { MemoryArtifactStore, MemoryJobStore, MemoryTaskQueue } from "./adapters.js";
import { canonicalSignature, hmac } from "./security.js";

const executorSecret = "executor-test-secret";
function signed(method: string, path: string, body = "") {
  const timestamp = Date.now().toString();
  return { timestamp, signature: hmac(executorSecret, canonicalSignature(timestamp, method, path, body)) };
}

describe("Stitch executor", () => {
  it("creates idempotent jobs, executes them, and returns persisted HTML", async () => {
    const jobs = new MemoryJobStore();
    const artifacts = new MemoryArtifactStore();
    const queue = new MemoryTaskQueue();
    const app = createApp({
      jobs, artifacts, queue, executorSecret, readTokenSecret: "read-test-secret", verifyTask: async () => true,
      generator: { generate: async () => ({ projectId: "project", screenId: "screen", html: "<!doctype html><html><body>ok</body></html>", htmlBytes: 43 }) },
    });
    const body = JSON.stringify({ prompt: "build", idempotencyKey: "run-1" });
    const auth = signed("POST", "/v1/jobs", body);
    const created = await request(app).post("/v1/jobs").set("X-GenUI-Timestamp", auth.timestamp).set("X-GenUI-Signature", auth.signature).set("Content-Type", "application/json").send(body).expect(202);
    expect(queue.jobs).toEqual([created.body.jobId]);
    await request(app).post(`/internal/jobs/${created.body.jobId}/execute`).send({}).expect(200);
    const path = `/v1/jobs/${created.body.jobId}?token=${encodeURIComponent(created.body.readToken)}`;
    const readAuth = signed("GET", path);
    const result = await request(app).get(path).set("X-GenUI-Timestamp", readAuth.timestamp).set("X-GenUI-Signature", readAuth.signature).expect(200);
    expect(result.body.status).toBe("succeeded");
    expect(result.body.artifact.htmlSource).toContain("<body>ok</body>");
  });

  it("rejects unsigned requests", async () => {
    const app = createApp({ jobs: new MemoryJobStore(), artifacts: new MemoryArtifactStore(), queue: new MemoryTaskQueue(), executorSecret, readTokenSecret: "read", verifyTask: async () => true, generator: { generate: async () => { throw new Error("unused"); } } });
    await request(app).post("/v1/jobs").send({ prompt: "x", idempotencyKey: "x" }).expect(401);
  });

  it("allows Cloud Tasks to retry one failed generation attempt", async () => {
    const jobs = new MemoryJobStore();
    let attempts = 0;
    const app = createApp({
      jobs, artifacts: new MemoryArtifactStore(), queue: new MemoryTaskQueue(), executorSecret, readTokenSecret: "read", verifyTask: async () => true,
      generator: { generate: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return { projectId: "project", screenId: "screen", html: "<html>ok</html>", htmlBytes: 15 };
      } },
    });
    const body = JSON.stringify({ prompt: "build", idempotencyKey: "retry-1" });
    const auth = signed("POST", "/v1/jobs", body);
    const created = await request(app).post("/v1/jobs").set("X-GenUI-Timestamp", auth.timestamp).set("X-GenUI-Signature", auth.signature).set("Content-Type", "application/json").send(body).expect(202);
    await request(app).post(`/internal/jobs/${created.body.jobId}/execute`).send({}).expect(500);
    await request(app).post(`/internal/jobs/${created.body.jobId}/execute`).send({}).expect(200);
    expect((await jobs.get(created.body.jobId))?.attempts).toBe(2);
    expect((await jobs.get(created.body.jobId))?.status).toBe("succeeded");
  });
});
