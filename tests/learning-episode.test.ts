import { describe, expect, it } from "vitest";
import { appendEpisodeEdit, createGenerationEpisode, finalizeEpisode, recordInitialOpenUI } from "../src/learning/episode";

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
});
