import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as createJob } from "../src/app/api/stitch/jobs/route";
import { GET as readJob } from "../src/app/api/stitch/jobs/[jobId]/route";

const originalUrl = process.env.STITCH_EXECUTOR_URL;
const originalSecret = process.env.STITCH_EXECUTOR_SECRET;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.STITCH_EXECUTOR_URL; else process.env.STITCH_EXECUTOR_URL = originalUrl;
  if (originalSecret === undefined) delete process.env.STITCH_EXECUTOR_SECRET; else process.env.STITCH_EXECUTOR_SECRET = originalSecret;
});

describe("Stitch Site job proxy", () => {
  it("sends only the constructed prompt and idempotency key to the executor", async () => {
    process.env.STITCH_EXECUTOR_URL = "https://executor.example";
    process.env.STITCH_EXECUTOR_SECRET = "test-secret";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ "X-GenUI-Timestamp": expect.any(String), "X-GenUI-Signature": expect.any(String) });
      const body = JSON.parse(String(init.body));
      expect(body.idempotencyKey).toBe("episode-1");
      expect(body.prompt).toContain("Simplified Chinese");
      expect(body).not.toHaveProperty("cardPlan");
      return new Response(JSON.stringify({ jobId: "stj_12345678", readToken: "token", status: "queued", pollAfterMs: 1500 }), { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await createJob(new Request("https://site.example/api/stitch/jobs", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        idempotencyKey: "episode-1", query: "北京旅行", cardPlan: {
          skillName: "旅行", reasoning: "两张卡", cards: [{ id: "card_1", purpose: "概览", blocks: [{ kind: "summary", text: "三日行程" }] }],
        },
      }),
    }));
    expect(response.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledWith("https://executor.example/v1/jobs", expect.objectContaining({ method: "POST" }));
  });

  it("keeps the read token server-proxied", async () => {
    process.env.STITCH_EXECUTOR_URL = "https://executor.example";
    process.env.STITCH_EXECUTOR_SECRET = "test-secret";
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://executor.example/v1/jobs/stj_12345678?token=private-token");
      return new Response(JSON.stringify({ jobId: "stj_12345678", status: "running", phase: "generating", elapsedMs: 1000 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await readJob(new Request("https://site.example/api/stitch/jobs/stj_12345678?token=private-token"), { params: Promise.resolve({ jobId: "stj_12345678" }) });
    expect(response.status).toBe(200);
  });
});
