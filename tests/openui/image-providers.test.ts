import { describe, expect, it, vi } from "vitest";
import {
  createImageSearchProviders,
  NoopImageSearchProvider,
  OpenverseImageSearchProvider,
  PexelsImageSearchProvider,
} from "../../src/openui/providers";
import { resolveAssetManifest } from "../../src/openui/assetResolver";
import { sampleCardPlan } from "./fixtures";

const pexelsResponse = (photos: unknown[]) => Response.json({ photos });
const pexelsPhoto = {
  url: "https://www.pexels.com/photo/123/",
  alt: "City skyline at dusk",
  photographer: "Ada Lovelace",
  photographer_url: "https://www.pexels.com/@ada/",
  src: { landscape: "https://images.pexels.com/photos/123/pexels-photo-123.jpeg", large: "https://images.pexels.com/photos/123/large.jpg", medium: "https://images.pexels.com/photos/123/medium.jpg" },
};

const mediaPlan = {
  ...sampleCardPlan,
  cards: [{
    ...sampleCardPlan.cards[0],
    blocks: [{
      ...sampleCardPlan.cards[0].blocks[0],
      assetRequest: { kind: "image" as const, query: "hotel exterior", count: 1, role: "hero" as const },
    }],
  }],
};

describe("Pexels adapter", () => {
  it("issues an authorized GET search request and maps src.landscape", async () => {
    const fetchMock = vi.fn(async () => pexelsResponse([pexelsPhoto]));
    const provider = new PexelsImageSearchProvider("test-key", { fetchImpl: fetchMock as unknown as typeof fetch });

    const candidates = await provider.search({ query: "hotel exterior", limit: 2 });

    expect(candidates).toEqual([{
      imageUrl: "https://images.pexels.com/photos/123/pexels-photo-123.jpeg",
      sourceUrl: "https://www.pexels.com/photo/123/",
      alt: "City skyline at dusk",
      creator: "Ada Lovelace",
      creatorUrl: "https://www.pexels.com/@ada/",
    }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://api.pexels.com/v1/search?query=hotel+exterior&per_page=2");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: "test-key" });
  });

  it("falls back to src.large when landscape is missing and drops empty imageUrls", async () => {
    const fetchMock = vi.fn(async () => pexelsResponse([
      { ...pexelsPhoto, src: { large: "https://images.pexels.com/large.jpg" } },
      { ...pexelsPhoto, src: {} },
    ]));
    const provider = new PexelsImageSearchProvider("test-key", { fetchImpl: fetchMock as unknown as typeof fetch });

    const candidates = await provider.search({ query: "hotel", limit: 2 });

    expect(candidates.map((candidate) => candidate.imageUrl)).toEqual(["https://images.pexels.com/large.jpg"]);
  });

  it("surfaces provider errors on non-2xx responses", async () => {
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    const provider = new PexelsImageSearchProvider("bad-key", { fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(provider.search({ query: "hotel", limit: 1 })).rejects.toThrow("Pexels HTTP 401");
  });
});

describe("Openverse adapter", () => {
  it("queries the public images endpoint and maps only returned fields", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      results: [{
        url: "https://live.staticflickr.com/1/a.jpg",
        title: "Kyoto street",
        foreign_landing_url: "https://flickr.com/photos/x/1",
        creator: "Grace Hopper",
        creator_url: "https://flickr.com/people/x",
        license: "by",
        license_version: "2.0",
      }],
    }));
    const provider = new OpenverseImageSearchProvider({ fetchImpl: fetchMock as unknown as typeof fetch });

    const candidates = await provider.search({ query: "kyoto street", limit: 1 });

    expect(candidates).toEqual([{
      imageUrl: "https://live.staticflickr.com/1/a.jpg",
      sourceUrl: "https://flickr.com/photos/x/1",
      alt: "Kyoto street",
      creator: "Grace Hopper",
      creatorUrl: "https://flickr.com/people/x",
      license: "by 2.0",
      licenseUrl: undefined,
    }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://api.openverse.org/v1/images/?q=kyoto+street&page_size=1");
    expect(init.method).toBe("GET");
  });

  it("returns [] on zero results without throwing", async () => {
    const fetchMock = vi.fn(async () => Response.json({ results: [] }));
    const provider = new OpenverseImageSearchProvider({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(provider.search({ query: "nothing", limit: 1 })).resolves.toEqual([]);
  });

  it("skips results without a usable image url", async () => {
    const fetchMock = vi.fn(async () => Response.json({ results: [{ title: "no url" }, { url: "https://cdn.example/b.jpg" }] }));
    const provider = new OpenverseImageSearchProvider({ fetchImpl: fetchMock as unknown as typeof fetch });

    const candidates = await provider.search({ query: "q", limit: 2 });

    expect(candidates.map((candidate) => candidate.imageUrl)).toEqual(["https://cdn.example/b.jpg"]);
  });
});

describe("image provider router", () => {
  it("prefers custom, then Pexels, then Openverse when each is configured", () => {
    const providers = createImageSearchProviders({
      IMAGE_SEARCH_API_URL: "https://images.example/search",
      IMAGE_SEARCH_API_KEY: "k",
      PEXELS_API_KEY: "p",
    });

    expect(providers.map((provider) => provider.kind)).toEqual(["custom-http-v1", "pexels", "openverse"]);
  });

  it("falls back to Openverse alone when no Pexels key exists", () => {
    const providers = createImageSearchProviders({});

    expect(providers.map((provider) => provider.kind)).toEqual(["openverse"]);
  });

  it("reaches Noop only when Openverse is explicitly disabled and no other provider exists", () => {
    const providers = createImageSearchProviders({ OPENVERSE_IMAGES: "off" });

    expect(providers).toHaveLength(1);
    expect(providers[0]).toBeInstanceOf(NoopImageSearchProvider);
  });

  it("keeps Openverse disabled when explicitly turned off even with other providers", () => {
    const providers = createImageSearchProviders({ PEXELS_API_KEY: "p", OPENVERSE_IMAGES: "off" });

    expect(providers.map((provider) => provider.kind)).toEqual(["pexels"]);
  });
});

describe("provider chain fallback during resolution", () => {
  it("moves to the next provider after a provider error and records both", async () => {
    const failing = { kind: "pexels", search: async () => { throw new Error("Pexels HTTP 429"); } };
    const serving = {
      kind: "openverse",
      search: async () => [{ imageUrl: "https://cdn.example/ok.jpg", alt: "酒店外观", creator: "X", license: "by 4.0" }],
    };
    const result = await resolveAssetManifest(mediaPlan, {
      providers: [failing, serving],
      validate: async (url) => ({ ok: true, url }),
    });

    expect(result.diagnostics.providerState).toBe("ready");
    expect(result.diagnostics.providersTried).toEqual(["pexels", "openverse"]);
    expect(result.diagnostics.events).toContainEqual(expect.objectContaining({ stage: "provider-request", provider: "pexels", reason: "Pexels HTTP 429" }));
    expect(result.manifest.assets[0]).toMatchObject({ id: "asset_overview_first_1", provider: "openverse", creator: "X", license: "by 4.0" });
  });

  it("keeps attribution fields out of the model-facing payload", async () => {
    const serving = { kind: "openverse", search: async () => [{ imageUrl: "https://cdn.example/ok.jpg", creator: "X", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" }] };
    const result = await resolveAssetManifest(mediaPlan, {
      providers: [serving],
      validate: async (url) => ({ ok: true, url }),
    });
    const { buildOpenUIGenerationPayload } = await import("../../src/openui/payload");

    const payload = buildOpenUIGenerationPayload(mediaPlan, result.manifest);
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("asset_overview_first_1");
    expect(serialized).not.toContain("creativecommons.org");
    expect(serialized).not.toContain("https://");
  });
});
