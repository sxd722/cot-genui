import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/skills/abstract/route";
import { displayQueryAbstraction, toGenericQueryAbstraction, validateQueryAbstraction } from "../../src/learning/queryAbstraction";

const originalGroqKey = process.env.GROQ_API_KEY;

afterEach(() => {
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
});

function request(body: unknown) {
  return new Request("http://localhost/api/skills/abstract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const base = {
  query: "去北京旅游",
  classification: { taskFamily: "planning", decisionMode: "explore", confidence: 0.9, source: "heuristic" },
  layoutMode: "free",
  profileContext: { domains: ["travel"], retrievalKeys: ["destination"] },
  modelProfile: "groq_qwen_3_6_27b",
};

describe("query abstraction", () => {
  it("validates and renders a parameterized invocation", () => {
    const abstraction = validateQueryAbstraction({
      formatVersion: "genui-query-abstraction/1",
      intentKey: "travel_planning",
      displayName: "旅游",
      invariantSummary: "规划一次符合约束的旅行",
      invariantTerms: ["旅行", "规划"],
      parameters: [{ key: "destination", label: "目的地", valueKind: "location", value: "北京", source: "query", confidence: 0.98 }],
      constraints: [], confidence: 0.96,
    });
    expect(displayQueryAbstraction(abstraction)).toBe("旅游(destination=北京)");
    expect(JSON.stringify(toGenericQueryAbstraction(abstraction))).not.toContain("北京");
  });

  it("rejects URL leakage in model output", () => {
    expect(() => validateQueryAbstraction({
      formatVersion: "genui-query-abstraction/1", intentKey: "travel_planning", displayName: "旅游",
      invariantSummary: "打开 https://example.test", invariantTerms: ["旅行"], parameters: [], constraints: [], confidence: 1,
    })).toThrow();
  });

  it("returns an explicit unconfigured response for client fallback", async () => {
    delete process.env.GROQ_API_KEY;
    const response = await POST(request(base));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "abstraction_model_unconfigured" });
  });

  it("rejects malformed abstraction requests", async () => {
    const response = await POST(request({ ...base, profileContext: { domains: ["https://private.test"], retrievalKeys: [] } }));
    expect(response.status).toBe(400);
  });
});
