import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeAssetRequest } from "../../src/lib/cardPlanNormalize";
import { buildOpenUIGenerationPayload } from "../../src/openui/payload";
import { collectAssetRequests, isPrivateHostname, resolveAssetManifest } from "../../src/openui/assetResolver";
import { AssetRegistryProvider } from "../../src/openui/assetContext";
import { AssetImage } from "../../src/openui/components/AssetImage";
import { MediaHero } from "../../src/openui/components/MediaHero";
import { RecommendationGrid } from "../../src/openui/components/RecommendationGrid";
import { invalidAssetRefsInTree, type AssetManifest } from "../../src/openui/assetTypes";
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
    const result = await resolveAssetManifest(mediaPlan, {
      provider: { search: async () => [{ imageUrl: "https://cdn.example/image.jpg", alt: "酒店外观" }] },
      validate: async (url) => url,
    });
    const payload = buildOpenUIGenerationPayload(mediaPlan, result.manifest);
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

  it("renders an accepted assetRef through the host registry without model-authored URLs", () => {
    const manifest = {
      requests: [{ id: "asset_demo", cardId: "demo", kind: "image" as const, query: "demo", count: 1, role: "hero" as const }],
      assets: [{ id: "asset_demo", kind: "image" as const, src: "https://cdn.example/demo.jpg", alt: "Demo image" }],
    };
    const image = createElement(AssetImage.component, {
      props: { assetRef: "asset_demo", alt: "Resolved demo", aspect: "wide" },
      renderNode: () => null,
    });
    const Registry = AssetRegistryProvider as ComponentType<{ manifest?: AssetManifest | null }>;
    const html = renderToStaticMarkup(createElement(Registry, { manifest }, image));

    expect(html).toContain('src="https://cdn.example/demo.jpg"');
    expect(html).toContain('alt="Resolved demo"');
    expect(html).not.toContain("图片暂不可用");
  });

  it("renders semantic media components through the host registry", () => {
    const manifest: AssetManifest = {
      requests: [
        { id: "asset_hero", cardId: "hero", kind: "image", query: "hero", count: 1, role: "hero" },
        { id: "asset_pick", cardId: "picks", kind: "image", query: "pick", count: 1, role: "supporting" },
      ],
      assets: [
        { id: "asset_hero", kind: "image", src: "https://cdn.example/hero.jpg", alt: "Hero image" },
        { id: "asset_pick", kind: "image", src: "https://cdn.example/pick.jpg", alt: "Pick image" },
      ],
    };
    const hero = createElement(MediaHero.component, {
      props: { title: "目的地", assetRef: "asset_hero" }, renderNode: () => null,
    });
    const grid = createElement(RecommendationGrid.component, {
      props: { items: [{ title: "首选", assetRef: "asset_pick" }] }, renderNode: () => null,
    });
    const Registry = AssetRegistryProvider as ComponentType<{ manifest?: AssetManifest | null }>;
    const html = renderToStaticMarkup(createElement(Registry, { manifest }, createElement("div", null, hero, grid)));

    expect(html).toContain('src="https://cdn.example/hero.jpg"');
    expect(html).toContain('src="https://cdn.example/pick.jpg"');
    expect(html.match(/loading="lazy"/g)).toHaveLength(2);
    expect(html.match(/referrerPolicy="no-referrer"/g)).toHaveLength(2);
  });

  it("keeps safe placeholders when semantic media refs cannot be resolved", () => {
    const Registry = AssetRegistryProvider as ComponentType<{ manifest?: AssetManifest | null }>;
    const hero = createElement(MediaHero.component, {
      props: { title: "目的地", assetRef: "asset_missing" }, renderNode: () => null,
    });
    const grid = createElement(RecommendationGrid.component, {
      props: { items: [{ title: "首选", assetRef: "asset_missing" }] }, renderNode: () => null,
    });
    const html = renderToStaticMarkup(createElement(Registry, { manifest: { requests: [], assets: [] } }, createElement("div", null, hero, grid)));

    expect(html).not.toContain("<img");
    expect(html).toContain("图片暂不可用");
  });
});
