import { describe, expect, it } from "vitest";
import { summarizeStepForProvenance, stableTextHash } from "../../src/lib/provenance";
import { classifyQuery } from "../../src/lib/adaptive/classification";

describe("compact provenance", () => {
  it("records hashes and safe structural metadata without code duplication", () => {
    const provenance = summarizeStepForProvenance("openui_generate", {
      classification: classifyQuery("推荐一个方案"),
      output: { openuiDiagnostics: { coverage: { required: 2, matched: 2, missing: [] }, parser: { statements: 4, unresolved: [], orphaned: [], incomplete: false }, repaired: false, repairTriggered: false } },
      cardPlan: { skillName: "测试", reasoning: "测试", cards: [{ id: "answer", purpose: "答案", blocks: [] }] },
      openuiCode: "root = CardDeck([])",
    });
    expect(provenance.codeHash).toBe(stableTextHash("root = CardDeck([])"));
    expect(provenance.cardIds).toEqual(["answer"]);
    expect(JSON.stringify(provenance)).not.toContain("root = CardDeck");
  });
});
