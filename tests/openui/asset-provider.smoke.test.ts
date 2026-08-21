import { describe, expect, it } from "vitest";
import { resolveAssetManifest } from "../../src/openui/assetResolver";
import { sampleCardPlan } from "./fixtures";

// Smoke 只在显式配置了真实凭据（custom endpoint 或 Pexels key）时运行；
// Openverse 虽默认启用，但不作为 smoke 的触发条件，保证 npm test 不触网。
const customConfigured = !!process.env.IMAGE_SEARCH_API_URL && !!process.env.IMAGE_SEARCH_API_KEY;
const pexelsConfigured = !!process.env.PEXELS_API_KEY;
const mediaPlan = {
  ...sampleCardPlan,
  cards: [{
    ...sampleCardPlan.cards[0],
    blocks: [{
      ...sampleCardPlan.cards[0].blocks[0],
      assetRequest: { kind: "image" as const, query: "public landmark exterior", count: 1, role: "hero" as const },
    }],
  }],
};

describe.skipIf(!(customConfigured || pexelsConfigured))("configured image-search provider smoke", () => {
  it("resolves at least one validated public image through the host-owned path", async () => {
    const result = await resolveAssetManifest(mediaPlan, { env: process.env });

    expect(result.diagnostics.providerState).toBe("ready");
    expect(result.diagnostics).toMatchObject({ requests: 1 });
    expect(result.diagnostics.candidates).toBeGreaterThan(0);
    expect(result.diagnostics.accepted).toBeGreaterThan(0);
    expect(result.manifest.assets[0]?.id).toBe("asset_overview_first_1");
  }, 20_000);
});
