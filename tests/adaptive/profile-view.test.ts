import { describe, expect, it } from "vitest";
import { buildProfileView } from "../../src/lib/profileView";
import type { ProfileDigest } from "../../src/lib/profileTypes";

const digest: ProfileDigest = {
  contextHash: "hash", version: "v1", generatedAt: "2026-08-19T00:00:00Z",
  core: { demographics: [], homeAndWork: [], household: ["有一个4岁孩子"], occupation: [], financialPosture: [], healthConstraints: ["膝盖近期轻微疼痛"], persistentPreferences: ["不喜欢拥挤"] },
  traits: [],
  domains: [
    { name: "family", summary: "家庭信息", availableSignals: ["children"], recordCount: 1, retrievalKeys: ["family.children"] },
    { name: "health", summary: "健康约束", availableSignals: ["knee"], recordCount: 1, retrievalKeys: ["health.knee"] },
    { name: "transport", summary: "交通方式", availableSignals: ["car"], recordCount: 1, retrievalKeys: ["transport.car"] },
  ],
  salientSignals: Array.from({ length: 12 }, (_, index) => ({ fact: `其他稳定信息 ${index}`, domain: "spending", confidence: 0.7, sourceRefs: [`spending.${index}`] })), conflicts: [],
};

describe("ProfileView V2", () => {
  it("recalls query-relevant raw details without exceeding the old digest budget", () => {
    const view = buildProfileView({
      query: "周末带孩子玩一天，别太累",
      digest,
      deviceContext: { family: { children: [{ age: 4 }] }, health: { knee: "recent mild pain" }, transport: { car: false }, preferences: { crowd: "dislike" }, spending: Array.from({ length: 40 }, (_, index) => index) },
      profileOverlay: "优先保留孩子年龄、交通便利性和减少折腾有关的细节。",
    });
    const refs = view.selectedDetails.map((detail) => detail.ref);
    expect(refs).toContain("family.children[0].age");
    expect(refs).toContain("health.knee");
    expect(refs).toContain("transport.car");
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(JSON.stringify(digest).length);
    expect(view.budget.profileViewChars).toBe(JSON.stringify(view).length);
  });
});
