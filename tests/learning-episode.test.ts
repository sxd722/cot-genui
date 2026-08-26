import { describe, expect, it } from "vitest";
import { appendEpisodeEdit, appendEpisodeFeedback, createGenerationEpisode, finalizeEpisode, recordInitialOpenUI } from "../src/learning/episode";

const classification = { taskFamily: "general" as const, decisionMode: "explore" as const, confidence: 0.8, source: "heuristic" as const };

describe("generation episode", () => {
  it("records initial code only once and stores a compact edit slice", () => {
    const started = createGenerationEpisode({ query: "test", classification });
    const initial = recordInitialOpenUI(started, "root = CardDeck([])", 0);
    const unchanged = recordInitialOpenUI(initial, "replacement", 1);
    expect(unchanged.initialOpenUI?.code).toBe("root = CardDeck([])");
    const edited = appendEpisodeEdit(unchanged, {
      id: "edit-1",
      createdAt: new Date().toISOString(),
      code: "whole code is not copied into edit record",
      instruction: "make concise",
      modelProfile: "glm_4_7_flash",
      target: { cardId: "a", x: 0.5, y: 0.5, pixelX: 10, pixelY: 10, nearbyText: "title", elementHint: "h2" },
      beforeSlice: "a = TextContent(\"before\")",
      afterSlice: "a = TextContent(\"after\")",
    });
    expect(edited.edits).toHaveLength(1);
    expect(edited.edits[0]).not.toHaveProperty("code");
    expect(finalizeEpisode(edited, "final").status).toBe("accepted");
  });

  it("records overall card-flow feedback without changing the generated artifact", () => {
    const initial = recordInitialOpenUI(createGenerationEpisode({ query: "test", classification }), "root = CardDeck([])", 0);
    const withFeedback = appendEpisodeFeedback(initial, "整体卡片太碎，希望先给结论，再展开细节。");
    expect(withFeedback.feedback).toHaveLength(1);
    expect(withFeedback.initialOpenUI?.code).toBe(initial.initialOpenUI?.code);
    const accepted = finalizeEpisode(withFeedback, "root = CardDeck([])");
    expect(accepted.finalOpenUI).toBe("root = CardDeck([])");
    expect(accepted.rewardMetrics?.feedbackCount).toBe(1);
    expect(accepted.rewardMetrics?.acceptedWithoutEdit).toBe(true);
  });
});
