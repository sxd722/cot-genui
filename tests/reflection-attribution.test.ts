import { describe, expect, it } from "vitest";
import { buildReflectionEpisodeView, deterministicAttribution, normalizeAttributionReport } from "../src/lib/reflection/attribution";
import type { GenerationEpisode } from "../src/learning/types";
import { REFLECTION_MODEL_PROFILE } from "../src/lib/reflection/config";

function episode(instruction?: string, feedback?: string): GenerationEpisode {
  return {
    id: "episode-1", schemaVersion: 1, query: "给我一个方案",
    queryClassification: { taskFamily: "recommendation", decisionMode: "compare", confidence: 0.9, source: "heuristic" },
    status: "accepted", startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:01:00Z", steps: {},
    initialOpenUI: { code: "root = CardDeck([card_0])", cardCount: 1, recordedAt: "2026-01-01T00:00:20Z" },
    feedback: feedback ? [{ id: "feedback-1", scope: "card-flow", text: feedback, createdAt: "2026-01-01T00:00:40Z" }] : [],
    edits: instruction ? [{
      versionId: "v1", cardId: "overview", instruction,
      target: { cardId: "overview", x: 0.5, y: 0.5, pixelX: 10, pixelY: 20, nearbyText: "价格", elementHint: "span" },
      beforeSlice: "body = TextContent(\"价格\")", afterSlice: "body = Badge(\"价格\")",
      modelProfile: "groq_qwen_3_6_27b", createdAt: "2026-01-01T00:00:30Z",
    }] : [],
  };
}

describe("reflection attribution", () => {
  it("pins long-context reflection to GLM Thinking", () => {
    expect(REFLECTION_MODEL_PROFILE).toBe("glm_5_2_thinking");
  });

  it("skips learning when a result is accepted without edits", () => {
    const report = deterministicAttribution(episode());
    expect(report?.reasonCodes).toContain("accepted_without_edits");
    expect(Object.values(report!.distribution).every((value) => value === 0)).toBe(true);
  });

  it("uses the no-model fast path for a targeted visual edit", () => {
    const report = deterministicAttribution(episode("把价格字号加大并高亮，更醒目"));
    expect(report?.modelUsed).toBe(false);
    expect(report?.reasonCodes).toContain("targeted_ui_edit");
    expect(report!.distribution.step6).toBeGreaterThan(0.9);
  });

  it("routes semantic corrections to model attribution", () => {
    expect(deterministicAttribution(episode("你理解错了，我真正想要的是低风险方案"))).toBeNull();
  });

  it("routes overall feedback to model attribution even without a card patch", () => {
    const accepted = episode(undefined, "整体顺序太散，应该先给结论，再展开依据。");
    expect(deterministicAttribution(accepted)).toBeNull();
    const view = buildReflectionEpisodeView(accepted);
    expect(view.overallFeedback[0].text).toContain("先给结论");
    expect(view.step6.overallOpenUI).toContain("CardDeck");
  });

  it("normalizes malformed probability sums and drops unknown stages", () => {
    const report = normalizeAttributionReport({ distribution: { step5: 2, step6: 2, step9: 10 }, topTargets: [] }, ["card_structure"], true);
    expect(report.distribution.step5 + report.distribution.step6).toBeCloseTo(1);
    expect(report.distribution).not.toHaveProperty("step9");
  });
});
