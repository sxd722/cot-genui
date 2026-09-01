import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/skills/resolve/route";

const originalGroqKey = process.env.GROQ_API_KEY;

afterEach(() => {
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
});

const base = {
  query: "去西安旅游",
  classification: { taskFamily: "planning", decisionMode: "explore", confidence: 0.9, source: "heuristic" },
  layoutMode: "free",
  profileContext: { domains: ["travel"], retrievalKeys: ["destination"] },
  modelProfile: "groq_qwen_3_6_27b",
  candidates: [{
    skillId: "skill_1", versionId: "skillv_1", name: "旅行规划", description: "规划目的地旅行",
    taskFamilies: ["planning"], decisionModes: ["explore"], semanticText: "travel planning destination",
    intentKey: "travel_planning", intentDisplayName: "旅游", invariantTerms: ["旅游", "规划"],
    parameterKeys: ["destination"], parameterKinds: ["location"], domains: ["travel"], slotKeys: ["destination"],
    profileDomains: ["travel"], capabilities: ["web-search"], cardArchetypes: ["timeline"], layoutModes: ["free"],
    actionTypes: ["navigate"], requiresFreshData: false,
  }],
};

function request(body: unknown) {
  return new Request("http://localhost/api/skills/resolve", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("one-pass Skill resolve route", () => {
  it("validates the combined abstraction and candidate request before model execution", async () => {
    const response = await POST(request({ ...base, candidates: [{ skillId: "incomplete" }] }));
    expect(response.status).toBe(400);
  });

  it("reports an unconfigured weak model without invoking the legacy two-call flow", async () => {
    delete process.env.GROQ_API_KEY;
    const response = await POST(request(base));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "resolver_model_unconfigured" });
  });
});

