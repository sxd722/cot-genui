import { describe, expect, it } from "vitest";
import { classifyQuery } from "../src/lib/adaptive/classification";
import { emptyStepHints } from "../src/lib/adaptive/defaultPolicies";
import type { AdaptivePolicyEntry } from "../src/lib/adaptive/types";
import { appendEpisodeEdit, createGenerationEpisode, finalizeEpisode, recordInitialOpenUI } from "../src/learning/episode";
import { deterministicAttribution } from "../src/lib/reflection/attribution";
import { normalizeGradientCandidates } from "../src/lib/reflection/gradient";
import { promoteCandidate } from "../src/lib/reflection/promotion";
import { extractCardSlice, mergeOpenUIPatch } from "../src/openui/editSlice";

describe("adaptive edit learning end-to-end smoke", () => {
  it("keeps the six-step result intact while learning from a validated target-card patch", () => {
    const classification = classifyQuery("推荐一个周末亲子方案，别太累");
    let episode = createGenerationEpisode({ query: "推荐一个周末亲子方案，别太累", classification, userKey: "user-hash" });
    const initialCode = `root = CardDeck([card_0])
card_0 = GeneratedCard("overview", "方案", [card_0_body])
card_0_body = Stack([price_text], "column", "m")
price_text = TextContent("预算适中")`;
    episode = recordInitialOpenUI(episode, initialCode, 1);
    const slice = extractCardSlice(initialCode, 0);
    const acceptedCode = mergeOpenUIPatch(initialCode, 'price_text = Badge("预算适中", "info")', new Set(slice.editableIds));
    const target = { cardId: "overview", x: 0.5, y: 0.5, pixelX: 120, pixelY: 80, nearbyText: "预算适中", elementHint: "span" };
    episode = appendEpisodeEdit(episode, {
      id: "edit-1", createdAt: "2026-08-19T00:01:00Z", code: acceptedCode,
      instruction: "这里更醒目一点", target, modelProfile: "groq_qwen_3_6_27b",
      beforeSlice: slice.source, afterSlice: extractCardSlice(acceptedCode, 0).source,
      metrics: { promptChars: 600, patchChars: 45, latencyMs: 250 },
    });
    const accepted = finalizeEpisode(episode, acceptedCode);
    const report = deterministicAttribution(accepted)!;
    expect(report.modelUsed).toBe(false);
    expect(report.distribution.step6).toBeGreaterThanOrEqual(0.85);
    expect(accepted.initialOpenUI?.code).toBe(initialCode);
    expect(accepted.finalOpenUI).toBe(acceptedCode);

    const policy: AdaptivePolicyEntry = { id: "default", scope: "class", taskFamily: classification.taskFamily, profileOverlay: "", stepHints: emptyStepHints(), version: 0, status: "stable", supportCount: 0, updatedAt: "2026-08-19T00:00:00Z" };
    const [candidate] = normalizeGradientCandidates({ candidates: [{ target: "openui_generate", themeKey: "increase_visual_hierarchy", candidateText: "同类推荐中优先强化会改变选择的主结论和关键差异。", confidence: 0.9, scopeSuggestion: "class", rationaleSummary: ["targeted visual correction"] }] }, { episode: accepted, attribution: report, currentPolicy: policy });
    const learned = promoteCandidate(candidate, [policy]);
    expect(learned.taskFamily).toBe("recommendation");
    expect(learned.version).toBe(1);
    expect(learned.stepHints.openui_generate).toBe(candidate.candidateText);
  });
});

