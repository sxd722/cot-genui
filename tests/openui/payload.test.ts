import { describe, expect, it } from "vitest";
import { buildOpenUIBootstrap } from "../../src/openui/bootstrap";
import { buildOpenUIGenerationPayload, buildOpenUIRepairPayload } from "../../src/openui/payload";
import { openUIActionRef } from "../../src/openui/actionRefs";
import { cardPlanToVibeMarkdown } from "../../src/openui/vibeMarkdown";
import type { CardPlan } from "../../src/dsl/modules";
import { sampleCardPlan, sixCardPlan } from "./fixtures";

function legacyPayload(cardPlan: CardPlan) {
  const bootstrap = buildOpenUIBootstrap(cardPlan);
  return {
    vibeMarkdown: cardPlanToVibeMarkdown(cardPlan),
    requiredShell: bootstrap.code,
    cardManifest: bootstrap.bodyRefs,
    actionBindings: cardPlan.cards.flatMap((card) => (card.actions ?? []).map((action) => ({
      ref: openUIActionRef(card.id, action.id),
      cardId: card.id,
      actionId: action.id,
      label: action.label,
      type: action.type,
      role: action.role,
    }))),
    acceptance: {
      protocol: "OpenUI Lang v0.5",
      root: "CardDeck",
      expectedCardCount: cardPlan.cards.length,
      oneDistinctCardPerCardPlanCard: true,
      preserveCardOrder: true,
      forbidMergedOrNestedCards: true,
      factsAndIntentRequired: true,
      visualCompositionIsOpenEnded: true,
      actionSyntax: "Use each supplied actionRef exactly once via Button + @ToAssistant or a HostAction component",
    },
  };
}

describe("OpenUI model payload", () => {
  it.each([
    ["3 cards", sampleCardPlan],
    ["6 cards", sixCardPlan],
  ])("sends only the required shell and design brief for %s", (_label, cardPlan) => {
    const payload = buildOpenUIGenerationPayload(cardPlan);

    expect(Object.keys(payload)).toEqual(["requiredShell", "designBrief"]);
    expect(payload).not.toHaveProperty("cardPlanMarkdown");
    expect(payload).not.toHaveProperty("cardPlan");
    expect(payload).not.toHaveProperty("cardManifest");
    expect(payload).not.toHaveProperty("actionBindings");
    expect(payload).not.toHaveProperty("acceptance");
    expect(payload.designBrief.cards).toHaveLength(cardPlan.cards.length);
    // 与历史 legacy 协议相比保持精简
    expect(JSON.stringify(payload).length).toBeLessThan(JSON.stringify(legacyPayload(cardPlan)).length);
  });

  it("keeps renderable facts and safe action refs inside the design brief", () => {
    const payload = buildOpenUIGenerationPayload(sampleCardPlan);
    const serialized = JSON.stringify(payload);

    expect(serialized).toContain("整体最均衡");
    expect(serialized).toContain(`plan:${encodeURIComponent("compare")}:${encodeURIComponent("details")}`);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("Vibe brief");
    expect(serialized).not.toContain("整体创作方向");
  });

  it("does not resend the design brief or action bindings during repair", () => {
    const payload = buildOpenUIRepairPayload(sampleCardPlan, "broken source", {
      valid: false,
      errors: ["missing body"],
      coverage: { required: 4, matched: 3, missing: ["plan:compare:details"] },
      parser: { statements: 3, unresolved: ["card_1_body"], orphaned: [], incomplete: false },
    });

    expect(Object.keys(payload)).toEqual(["requiredShell", "previousOpenUI", "validationErrors", "missingCoverage"]);
    expect(payload).not.toHaveProperty("cardPlanMarkdown");
    expect(payload).not.toHaveProperty("designBrief");
    expect(payload).not.toHaveProperty("actionBindings");
  });
});
