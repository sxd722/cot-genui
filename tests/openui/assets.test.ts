import { describe, expect, it } from "vitest";
import { normalizeAssetRequest } from "../../src/lib/cardPlanNormalize";
import { buildOpenUIGenerationPayload } from "../../src/openui/payload";
import { collectAssetRequests, isPrivateHostname, resolveAssetManifest } from "../../src/openui/assetResolver";
import { invalidAssetRefsInTree } from "../../src/openui/assetTypes";
import { createParser, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import librarySpec from "../../src/openui/generated/system-prompt.spec.json";
import { sampleCardPlan } from "./fixtures";

const mediaPlan = {
  ...sampleCardPlan,
  cards: [{ ...sampleCardPlan.cards[0], blocks: [{ ...sampleCardPlan.cards[0].blocks[0], assetRequest: { kind: "image" as const, query: "北京海淀区酒店外观", count: 1, role: "hero" as const } }] }],
};

describe("host-owned OpenUI assets", () => {
  it("normalizes bounded asset requests", () => {
    expect(normalizeAssetRequest({ kind: "image", query: "北京海淀区酒店外观", count: 0, role: "hero" })).toEqual({ kind: "image", query: "北京海淀区酒店外观", count: 1, role: "hero" });
    expect(normalizeAssetRequest({ kind: "gallery", query: "x".repeat(200), count: 99, role: "gallery" })?.query).toHaveLength(160);
    expect(normalizeAssetRequest({ kind: "gallery", query: "photos", count: 99, role: "gallery" })?.count).toBe(6);
  });

  it("collects stable requests and exposes only safe IDs to the model payload", async () => {
    expect(collectAssetRequests(mediaPlan)[0]).toMatchObject({ id: "asset_overview_first_1", cardId: "overview/first" });
    const manifest = await resolveAssetManifest(mediaPlan, {
      provider: { search: async () => [{ imageUrl: "https://cdn.example/image.jpg", alt: "酒店外观" }] },
      validate: async (url) => url,
    });
    const payload = buildOpenUIGenerationPayload(mediaPlan, manifest);
    expect(JSON.stringify(payload)).toContain("asset_overview_first_1");
    expect(JSON.stringify(payload)).not.toContain("https://");
  });

  it("rejects local and private network targets before fetching", () => {
    for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.1.2", "192.168.1.1", "::1", "service.local"]) expect(isPrivateHostname(host)).toBe(true);
    expect(isPrivateHostname("8.8.8.8")).toBe(false);
  });

  it("detects model-invented asset refs against the host manifest", () => {
    const parsed = createParser((librarySpec as LibrarySpec).schema as LibraryJSONSchema).parse('root = CardDeck([card], "auto")\ncard = GeneratedCard("a", "A", [image])\nimage = AssetImage("asset_invented")');
    expect(invalidAssetRefsInTree(parsed.root, { requests: [], assets: [] })).toEqual(["asset_invented"]);
    expect(invalidAssetRefsInTree(parsed.root, { requests: [], assets: [{ id: "asset_invented", kind: "image", src: "https://safe.example/a.jpg", alt: "A" }] })).toEqual([]);
  });
});
