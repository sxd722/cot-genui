import { describe, expect, it, vi } from "vitest";
import { createParser, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import {
  ContractImageSearchProvider,
  disabledAssetResolution,
  resolveAssetManifest,
  validatePublicImageUrl,
  validatePublicImageUrlDetailed,
} from "../../src/openui/assetResolver";
import { buildOpenUIGenerationPayload } from "../../src/openui/payload";
import { invalidAssetRefsInTree, type ImageSearchProvider } from "../../src/openui/assetTypes";
import librarySpec from "../../src/openui/generated/system-prompt.spec.json";
import { sampleCardPlan } from "./fixtures";

const mediaPlan = {
  ...sampleCardPlan,
  cards: [{
    ...sampleCardPlan.cards[0],
    blocks: [{
      ...sampleCardPlan.cards[0].blocks[0],
      assetRequest: { kind: "image" as const, query: "北京海淀区酒店外观", count: 1, role: "hero" as const },
    }],
  }],
};

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const imageHeaders = { "content-type": "image/jpeg", "content-length": "2048" };

describe("observable host-owned asset resolution", () => {
  it("reports noop-unconfigured instead of silently returning no assets", async () => {
    const result = await resolveAssetManifest(mediaPlan, { env: { OPENVERSE_IMAGES: "off" } });

    expect(result.manifest.assets).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      providerState: "noop-unconfigured",
      requests: 1,
      candidates: 0,
      accepted: 0,
      rejected: 0,
    });
    expect(result.diagnostics.events).toContainEqual(expect.objectContaining({ stage: "configuration", reason: expect.any(String) }));
  });

  it("records provider exceptions with request identity and degrades gracefully", async () => {
    const provider: ImageSearchProvider = { search: async () => { throw new Error("provider unavailable"); } };
    const result = await resolveAssetManifest(mediaPlan, { provider });

    expect(result.manifest.assets).toEqual([]);
    expect(result.diagnostics.providerState).toBe("provider-error");
    expect(result.diagnostics.events).toContainEqual(expect.objectContaining({
      stage: "provider-request",
      requestId: "asset_overview_first_1",
      reason: "provider unavailable",
    }));
  });

  it("rejects malformed custom-provider responses instead of assuming an arbitrary images shape", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ images: [{ imageUrl: "https://cdn.example/a.jpg" }] })) as unknown as typeof fetch;
    const provider = new ContractImageSearchProvider("https://images.example/search", "test-key", { fetchImpl });
    const result = await resolveAssetManifest(mediaPlan, { provider, validate: async (url) => ({ ok: true, url }) });

    expect(result.diagnostics.providerState).toBe("provider-error");
    expect(result.diagnostics.events).toContainEqual(expect.objectContaining({ stage: "provider-response", reason: expect.stringContaining("schemaVersion") }));
  });

  it("reports zero-results distinctly", async () => {
    const result = await resolveAssetManifest(mediaPlan, { provider: { search: async () => [] } });

    expect(result.diagnostics.providerState).toBe("zero-results");
    expect(result.diagnostics).toMatchObject({ requests: 1, candidates: 0, accepted: 0, rejected: 0 });
  });

  it("distinguishes disabled, configured, and validation-rejected states", async () => {
    expect(disabledAssetResolution(mediaPlan).diagnostics.providerState).toBe("disabled");
    const configured = await resolveAssetManifest({ ...mediaPlan, cards: [] }, { provider: { search: async () => [] } });
    expect(configured.diagnostics.providerState).toBe("configured");
    const rejected = await resolveAssetManifest(mediaPlan, {
      provider: { search: async () => [{ imageUrl: "https://cdn.example/not-an-image" }] },
      validate: async () => ({ ok: false, stage: "head", reason: "content-type is text/html", statusCode: 200 }),
    });
    expect(rejected.diagnostics.providerState).toBe("validation-rejected");
    expect(rejected.diagnostics).toMatchObject({ candidates: 1, accepted: 0, rejected: 1 });
    expect(rejected.diagnostics.events).toContainEqual(expect.objectContaining({ stage: "head", reason: "content-type is text/html" }));
  });

  it("implements the configured custom HTTP v1 request and response contract", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      schemaVersion: "1",
      results: [{ imageUrl: "https://cdn.example/a.jpg", sourceUrl: "https://example.com/a", alt: "A" }],
    }));
    const provider = new ContractImageSearchProvider("https://images.example/search", "test-key", { fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(provider.search({ query: "city", limit: 2 })).resolves.toEqual([
      { imageUrl: "https://cdn.example/a.jpg", sourceUrl: "https://example.com/a", alt: "A" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://images.example/search", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-key" },
      body: JSON.stringify({ query: "city", limit: 2 }),
    }));
  });

  it("accepts an HTTPS public image after a successful HEAD probe", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(null, { status: 200, headers: imageHeaders });
    });
    const value = await validatePublicImageUrl("https://cdn.example/photo.jpg", { fetchImpl: fetchMock as unknown as typeof fetch, lookupImpl: publicLookup });

    expect(value).toBe("https://cdn.example/photo.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "HEAD", redirect: "manual" });
  });

  it("falls back to a bounded Range GET when HEAD is unsupported", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "HEAD"
      ? new Response(null, { status: 405 })
      : new Response(new Uint8Array([1]), { status: 206, headers: imageHeaders }));
    const value = await validatePublicImageUrl("https://cdn.example/photo.jpg", { fetchImpl: fetchMock as unknown as typeof fetch, lookupImpl: publicLookup });

    expect(value).toBe("https://cdn.example/photo.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "GET", headers: { Range: "bytes=0-1023" }, redirect: "manual" });
  });

  it("uses the Range GET fallback when HEAD omits content-type", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "HEAD"
      ? new Response(null, { status: 200 })
      : new Response(new Uint8Array([1]), { status: 200, headers: imageHeaders }));
    const value = await validatePublicImageUrl("https://cdn.example/photo.jpg", { fetchImpl: fetchMock as unknown as typeof fetch, lookupImpl: publicLookup });

    expect(value).toBe("https://cdn.example/photo.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects private targets before making an HTTP request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await validatePublicImageUrlDetailed("https://127.0.0.1/private.jpg", { fetchImpl, lookupImpl: publicLookup });

    expect(result).toMatchObject({ ok: false, stage: "url-policy", reason: expect.stringContaining("private") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects public-looking hostnames that DNS resolves to an IPv4-mapped private address", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const result = await validatePublicImageUrlDetailed("https://cdn.example/private.jpg", {
      fetchImpl: fetchMock,
      lookupImpl: async () => [{ address: "::ffff:127.0.0.1", family: 6 }],
    });

    expect(result).toMatchObject({ ok: false, stage: "dns", reason: expect.stringContaining("private") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses opt-in DoH when system DNS returns a TUN fake-IP", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://cloudflare-dns.com/dns-query")) {
        return Response.json({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] });
      }
      return new Response(null, { status: 200, headers: imageHeaders });
    });
    const result = await validatePublicImageUrlDetailed("https://cdn.example/photo.jpg", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      lookupImpl: async () => [{ address: "198.18.0.18", family: 4 }],
      dnsValidationMode: "doh-fallback",
      dohUrl: "https://cloudflare-dns.com/dns-query",
    });

    expect(result).toMatchObject({ ok: true, url: "https://cdn.example/photo.jpg" });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("name=cdn.example"), expect.objectContaining({ headers: { Accept: "application/dns-json" } }));
  });

  it("keeps fake-IP rejection in system mode and rejects private DoH answers", async () => {
    const systemFetch = vi.fn() as unknown as typeof fetch;
    const system = await validatePublicImageUrlDetailed("https://cdn.example/photo.jpg", {
      fetchImpl: systemFetch,
      lookupImpl: async () => [{ address: "198.18.0.18", family: 4 }],
      dnsValidationMode: "system",
    });
    expect(system).toMatchObject({ ok: false, stage: "dns" });
    expect(systemFetch).not.toHaveBeenCalled();

    const dohFetch = vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 1, data: "127.0.0.1" }] }));
    const doh = await validatePublicImageUrlDetailed("https://cdn.example/photo.jpg", {
      fetchImpl: dohFetch as unknown as typeof fetch,
      lookupImpl: async () => [{ address: "198.18.0.18", family: 4 }],
      dnsValidationMode: "doh-fallback",
    });
    expect(doh).toMatchObject({ ok: false, stage: "dns", reason: expect.stringContaining("DoH") });
  });

  it("revalidates redirect destinations and rejects redirects to private hosts", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private.jpg" } }));
    const result = await validatePublicImageUrlDetailed("https://cdn.example/photo.jpg", { fetchImpl: fetchMock as unknown as typeof fetch, lookupImpl: publicLookup });

    expect(result).toMatchObject({ ok: false, stage: "redirect", reason: expect.stringContaining("private") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a successful manifest with structured counts and keeps the model payload ID-only", async () => {
    const result = await resolveAssetManifest(mediaPlan, {
      provider: { search: async () => [{ imageUrl: "https://cdn.example/photo.jpg", sourceUrl: "https://example.com/photo", alt: "酒店外观" }] },
      validate: async (url) => ({ ok: true, url }),
    });
    const payload = buildOpenUIGenerationPayload(mediaPlan, result.manifest);

    expect(result.diagnostics).toMatchObject({ providerState: "ready", requests: 1, candidates: 1, accepted: 1, rejected: 0 });
    expect(result.manifest.assets).toEqual([expect.objectContaining({ id: "asset_overview_first_1", src: "https://cdn.example/photo.jpg" })]);
    expect(JSON.stringify(payload)).toContain("asset_overview_first_1");
    expect(JSON.stringify(payload)).not.toContain("https://");
  });

  it("provides completion proof: accepted assetRef validates in an OpenUI artifact", async () => {
    const result = await resolveAssetManifest(mediaPlan, {
      provider: { search: async () => [{ imageUrl: "https://cdn.example/photo.jpg", alt: "酒店外观" }] },
      validate: async (url) => ({ ok: true, url }),
    });
    const artifact = [
      'root = CardDeck([card], "auto")',
      'card = GeneratedCard("overview/first", "先看方向", [image])',
      'image = AssetImage("asset_overview_first_1", "酒店外观", "wide")',
    ].join("\n");

    expect(result.diagnostics).toMatchObject({ requests: 1, candidates: 1, accepted: 1 });
    const parsed = createParser((librarySpec as LibrarySpec).schema as LibraryJSONSchema).parse(artifact);
    expect(parsed.meta.errors).toEqual([]);
    expect(parsed.meta.unresolved).toEqual([]);
    expect(invalidAssetRefsInTree(parsed.root, result.manifest)).toEqual([]);
  });
});
