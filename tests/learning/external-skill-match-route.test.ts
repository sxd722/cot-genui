import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/skills/match/route";

const originalGroqKey = process.env.GROQ_API_KEY;
const originalGlmKey = process.env.LLM_API_KEY;

afterEach(() => {
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
  if (originalGlmKey === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = originalGlmKey;
});

function request(body: unknown) {
  return new Request("http://localhost/api/skills/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const base = {
  abstraction: {
    formatVersion: "genui-query-abstraction/1",
    intentKey: "travel_planning",
    displayName: "旅游",
    invariantSummary: "比较并规划一次旅行",
    invariantTerms: ["旅行", "规划"],
    parameters: [{ key: "destination", valueKind: "location", value: "西安", source: "query", confidence: 0.98 }],
    constraints: [],
    confidence: 0.95,
  },
  classification: { taskFamily: "planning", decisionMode: "compare", confidence: 0.9, source: "heuristic" },
  layoutMode: "free",
  profileContext: { domains: ["travel"], retrievalKeys: ["destination"] },
  modelProfile: "groq_qwen_3_6_27b",
};

describe("external Skill matcher route", () => {
  it("returns without an LLM call when there are no eligible candidates", async () => {
    const response = await POST(request({ ...base, candidates: [] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ comparisons: [], noMatchReason: "no_candidates" });
  });

  it("reports the selected provider as unconfigured so the client can fall back locally", async () => {
    delete process.env.GROQ_API_KEY;
    const response = await POST(request({
      ...base,
      candidates: [{
        skillId: "skill_1", versionId: "skillv_1", name: "旅行比较", description: "比较旅行方案",
        taskFamilies: ["planning"], decisionModes: ["compare"], semanticText: "旅行 planning compare",
        intentKey: "travel_planning", intentDisplayName: "旅游", invariantTerms: ["旅行", "规划"],
        parameterKeys: ["destination"], parameterKinds: ["location"],
        domains: ["travel"], slotKeys: ["destination"], profileDomains: ["travel"], capabilities: [],
        cardArchetypes: ["comparison"], layoutModes: ["free"], actionTypes: [], requiresFreshData: false, localScore: 0.75,
      }],
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "matcher_model_unconfigured" });
  });

  it("rejects oversized or malformed candidate payloads", async () => {
    const response = await POST(request({ ...base, candidates: [{ skillId: "only-an-id" }] }));
    expect(response.status).toBe(400);
  });
});
