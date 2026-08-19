import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RESULT_VIEWS } from "../../src/lib/resultViews";

describe("OpenUI-first artifact cleanup", () => {
  it("exposes exactly the four production result views", () => {
    expect(RESULT_VIEWS).toEqual(["cardplan-markdown", "cardplan-json", "openui", "openui-source"]);
  });

  it("does not compile or enrich CardPlan in the production store", () => {
    const storeSource = readFileSync(resolve(process.cwd(), "src/store/useInferStore.ts"), "utf8");

    expect(storeSource).not.toMatch(/enrichAndCompile|enrichCardPlan|compileCardPlan|\/api\/search|\/api\/llm/);
  });

  it("does not expose duplicate Raw IR or legacy card renderers on the main page", () => {
    const pageSource = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

    expect(pageSource).not.toMatch(/Model Raw IR|StackedCards|DslCardHost/);
  });
});
