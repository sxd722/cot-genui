import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardPlan } from "../src/dsl/modules";
import { POST, parseStitchCardPlan } from "../src/app/api/stitch/generate/route";
import { StitchPreview } from "../src/components/StitchPreview";
import { fetchStitchHtmlSource, MAX_STITCH_HTML_BYTES } from "../src/stitch/html";
import { buildStitchPrompt } from "../src/stitch/prompt";
import { isStitchTransportReuseError, withStitchProject, type StitchProjectSessionFactory } from "../src/stitch/server";
import type { StitchArtifact } from "../src/stitch/types";
import type { Project } from "@google/stitch-sdk";
import { useInferStore } from "../src/store/useInferStore";

const originalApiKey = process.env.STITCH_API_KEY;

const plan: CardPlan = {
  skillName: "旅行建议",
  reasoning: "保持两张平级卡片",
  cards: [{
    id: "card_trip",
    title: "行程概览",
    purpose: "帮助用户快速理解行程",
    presentation: { archetype: "media", emphasis: "media" },
    blocks: [{
      kind: "summary",
      title: "北京三日游",
      text: "第一天游览故宫，详情见 https://private.example/path",
      imageUrl: "https://private.example/image.jpg",
    }],
    actions: [{
      id: "open_detail",
      label: "查看详情",
      type: "external-link",
      link: "https://private.example/action",
      role: "primary",
    }],
  }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useInferStore.setState({ currentEpisode: null });
  useInferStore.getState().reset();
  if (originalApiKey === undefined) delete process.env.STITCH_API_KEY;
  else process.env.STITCH_API_KEY = originalApiKey;
});

describe("Stitch MVP side path", () => {
  it("builds a topic-led prompt without OpenUI design or topology constraints", () => {
    const prompt = buildStitchPrompt(plan, "帮我规划北京旅行，参考 https://private.example/query");

    expect(prompt).toContain('"topic": "帮我规划北京旅行，参考 [宿主外链]"');
    expect(prompt).toContain('"title": "行程概览"');
    expect(prompt).toContain('"label": "查看详情"');
    expect(prompt).toContain("Simplified Chinese");
    expect(prompt).toContain("Freely decide the visual language, layout, and page structure");
    expect(prompt).toContain("merge, split, reorder, or reframe");
    expect(prompt).not.toContain("Preserve the number and order");
    expect(prompt).not.toContain("600 × 300");
    expect(prompt).not.toContain("designIntent");
    expect(prompt).not.toContain("archetype");
    expect(prompt).not.toContain("private.example");
    expect(prompt).not.toContain("open_detail");
    expect(prompt).not.toContain("actionRef");
  });

  it("strictly preserves card count, order, and 600x300 size in fixed mode", () => {
    const fixedPlan: CardPlan = {
      ...plan,
      layoutPolicy: {
        mode: "fixed-600x300",
        cardWidth: 600,
        cardHeight: 300,
        overflow: "forbid",
        innerScroll: false,
      },
    };
    const prompt = buildStitchPrompt(fixedPlan, "北京旅行");

    expect(prompt).toContain("exactly 1 top-level visual card");
    expect(prompt).toContain("exactly 600px wide and exactly 300px high");
    expect(prompt).toContain("Preserve the source section order");
    expect(prompt).toContain("No content may overflow, clip, or scroll inside a card");
    expect(prompt).not.toContain("merge, split, reorder, or reframe");
  });

  it("accepts the CardPlan shape used by the workspace", () => {
    expect(parseStitchCardPlan(plan)).toEqual(plan);
  });

  it("rejects malformed nested CardPlan data", () => {
    expect(parseStitchCardPlan({ ...plan, cards: [{ id: "bad", purpose: "bad", blocks: "not-an-array" }] })).toBeNull();
    expect(parseStitchCardPlan({ ...plan, cards: [{ id: "bad", purpose: "bad", blocks: [{ kind: "list", items: "not-an-array" }] }] })).toBeNull();
  });

  it("reports an explicit unconfigured state without calling Stitch", async () => {
    delete process.env.STITCH_API_KEY;
    const response = await POST(new Request("http://localhost/api/stitch/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardPlan: plan, query: "北京旅行" }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "stitch_unconfigured" });
  });

  it("uses a request-scoped Stitch session and always closes it", async () => {
    const close = vi.fn(async () => undefined);
    const openSession: StitchProjectSessionFactory = vi.fn(async () => ({
      project: { id: "project_scoped" } as Project,
      close,
    }));

    await expect(withStitchProject(async (project) => project.id, openSession)).resolves.toBe("project_scoped");
    expect(openSession).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("retries the stale-transport failure once with a fresh Stitch session", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const closes = [vi.fn(async () => undefined), vi.fn(async () => undefined)];
    let opened = 0;
    const openSession: StitchProjectSessionFactory = vi.fn(async () => {
      const index = opened;
      opened += 1;
      return {
        project: { id: `project_${opened}` } as Project,
        close: closes[index],
      };
    });
    let operations = 0;

    const result = await withStitchProject(async (project) => {
      operations += 1;
      if (operations === 1) {
        throw new Error("Already connected to a transport. Call close() before connecting to a new transport.");
      }
      return project.id;
    }, openSession);

    expect(result).toBe("project_2");
    expect(openSession).toHaveBeenCalledTimes(2);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).toHaveBeenCalledTimes(1);
    expect(isStitchTransportReuseError(new Error("Already connected to a transport"))).toBe(true);
  });

  it("downloads attachment-style HTML into a bounded H5 artifact", async () => {
    const source = "<!doctype html><html><body><main>Stitch H5</main></body></html>";
    const fetchImpl = vi.fn(async () => new Response(source, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=code.html",
      },
    })) as unknown as typeof fetch;

    await expect(fetchStitchHtmlSource("https://contribution.usercontent.google.com/download?id=test", fetchImpl)).resolves.toEqual({
      source,
      bytes: new TextEncoder().encode(source).byteLength,
    });
  });

  it("rejects oversized Stitch HTML before reading the response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "content-length": String(MAX_STITCH_HTML_BYTES + 1) },
    })) as unknown as typeof fetch;

    await expect(fetchStitchHtmlSource("https://contribution.usercontent.google.com/code.html", fetchImpl)).rejects.toThrow("exceeds");
  });

  it("rejects non-Google and non-HTTPS Stitch download URLs", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(fetchStitchHtmlSource("https://127.0.0.1/code.html", fetchImpl)).rejects.toThrow("allowed Google domain");
    await expect(fetchStitchHtmlSource("http://contribution.usercontent.google.com/code.html", fetchImpl)).rejects.toThrow("must use HTTPS");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("renders fetched H5 unchanged in an unrestricted demo iframe", () => {
    const artifact: StitchArtifact = {
      provider: "stitch",
      projectId: "project_1",
      screenId: "screen_1",
      model: "GEMINI_3_FLASH",
      htmlSource: "<!doctype html><html><body>real h5</body></html>",
      htmlBytes: 54,
      imageUrl: "https://images.example.com/screenshot.png",
      durationMs: 1200,
    };

    const markup = renderToStaticMarkup(createElement(StitchPreview, { artifact, loading: false }));
    expect(markup).toContain("srcDoc=");
    expect(markup).not.toContain("sandbox=");
    expect(markup).toContain("real h5");
    expect(markup).not.toContain("src=\"https://contribution.usercontent.google.com/download");
  });

  it("keeps the HTML preview usable while a Stitch screenshot is unavailable", () => {
    const artifact: StitchArtifact = {
      provider: "stitch",
      projectId: "project_1",
      screenId: "screen_1",
      model: "GEMINI_3_FLASH",
      htmlSource: "<!doctype html><html><body>html only</body></html>",
      htmlBytes: 52,
      imageUrl: "",
      durationMs: 1200,
    };

    const markup = renderToStaticMarkup(createElement(StitchPreview, { artifact, loading: false }));
    expect(markup).toContain("html only");
    expect(markup).not.toContain(">截图<");
    expect(markup).not.toContain("<img");
  });

  it("routes Step 6 directly to Stitch without calling the OpenUI infer endpoint", async () => {
    const artifact: StitchArtifact = {
      provider: "stitch",
      projectId: "project_1",
      screenId: "screen_1",
      model: "GEMINI_3_FLASH",
      htmlSource: "<!doctype html><html><body>direct stitch</body></html>",
      htmlBytes: 58,
      imageUrl: "https://lh3.googleusercontent.com/stitch.png",
      durationMs: 900,
    };
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      const [input] = args;
      if (String(input) !== "/api/stitch/generate") throw new Error(`unexpected endpoint: ${String(input)}`);
      return new Response(JSON.stringify(artifact), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    useInferStore.getState().setStep6Backend("stitch");
    useInferStore.setState({ cardPlan: plan, currentEpisode: null });

    await useInferStore.getState().runStep("openui_generate");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/stitch/generate");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ query: expect.any(String) });
    expect(useInferStore.getState().steps.openui_generate.status).toBe("done");
    expect(useInferStore.getState().steps.openui_generate.outputs.openuiModelCalls).toBe(0);
    expect(useInferStore.getState().openuiCode).toBeNull();
    expect(useInferStore.getState().stitchArtifact?.htmlSource).toContain("direct stitch");
  });
});
