import { describe, expect, it } from "vitest";
import { GLOBAL_STEP_HINTS } from "../../src/lib/adaptive/defaultPolicies";
import { cotGenUIPromptOptions } from "../../src/openui/promptOptions";

describe("semantic component selection guidance", () => {
  it("guides semantic fit without component quotas", () => {
    const rules = cotGenUIPromptOptions.additionalRules?.join(" ") ?? "";
    for (const phrase of [
      "Choose components by semantic fit, not novelty.",
      "Avoid rebuilding a semantic pattern",
      "Do not force charts, tabs, images, forms or carousels",
      "vary composition when card purposes differ",
      "Use visual hierarchy to distinguish primary conclusion, evidence, comparison and next action.",
      "Card component is allowed inside GeneratedCard as a local visual surface",
    ]) expect(rules).toContain(phrase);
    expect(rules).not.toMatch(/use at least \d+|at least \d+ component/i);
  });

  it("keeps the adaptive Step 6 steering concise and topology-neutral", () => {
    expect(GLOBAL_STEP_HINTS.openui_generate).toBe("把 CardPlan 当设计 brief；先选最能表达每张卡目的的组件组合，再组织层级与节奏，避免把所有卡都退化为 Stack + TextContent。");
    expect(GLOBAL_STEP_HINTS.openui_generate).not.toMatch(/\d+张|\d+个组件/);
  });
});
