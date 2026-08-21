import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createImageGatewayServer, createGatewayProviders } from "../../services/image-gateway/server";
import { SearxngImageSearchProvider } from "../../services/image-gateway/searxng";
import type { ImageSearchProvider } from "../../src/openui/assetTypes";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function startGateway(options: Parameters<typeof createImageGatewayServer>[0]) {
  const server = createImageGatewayServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("local image gateway", () => {
  it("exposes the custom-http-v1 contract and provider diagnostics in headers", async () => {
    const provider: ImageSearchProvider = {
      kind: "fixture",
      search: async () => [{ imageUrl: "https://cdn.example/city.jpg", sourceUrl: "https://example.com/city", alt: "City" }],
    };
    const baseUrl = await startGateway({ providers: [provider], apiKey: "local-dev" });

    const response = await fetch(`${baseUrl}/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer local-dev" },
      body: JSON.stringify({ query: "city skyline", limit: 2 }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-image-provider")).toBe("fixture");
    expect(await response.json()).toEqual({
      schemaVersion: "1",
      results: [{ imageUrl: "https://cdn.example/city.jpg", sourceUrl: "https://example.com/city", alt: "City" }],
    });
  });

  it("requires the configured bearer key and validates bounded input", async () => {
    const baseUrl = await startGateway({ providers: [{ kind: "fixture", search: async () => [] }], apiKey: "secret" });
    const unauthorized = await fetch(`${baseUrl}/v1/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "x", limit: 1 }) });
    const invalid = await fetch(`${baseUrl}/v1/search`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer secret" }, body: JSON.stringify({ query: "", limit: 99 }) });

    expect(unauthorized.status).toBe(401);
    expect(invalid.status).toBe(400);
  });

  it("falls through provider errors and zero results", async () => {
    const providers: ImageSearchProvider[] = [
      { kind: "broken", search: async () => { throw new Error("offline"); } },
      { kind: "empty", search: async () => [] },
      { kind: "ready", search: async () => [{ imageUrl: "https://cdn.example/ready.jpg" }] },
    ];
    const baseUrl = await startGateway({ providers });
    const response = await fetch(`${baseUrl}/v1/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "ready", limit: 1 }) });

    expect(response.headers.get("x-image-provider")).toBe("ready");
    expect(response.headers.get("x-image-provider-attempts")).toBe("broken,error;empty,zero-results;ready,ready");
    expect((await response.json() as { results: unknown[] }).results).toHaveLength(1);
  });

  it("routes explicitly configured providers in order", () => {
    const providers = createGatewayProviders({
      IMAGE_GATEWAY_PROVIDERS: "openverse,pexels,searxng",
      IMAGE_GATEWAY_PEXELS_API_KEY: "p",
      IMAGE_GATEWAY_SEARXNG_URL: "http://127.0.0.1:8888",
    });

    expect(providers.map((provider) => provider.kind)).toEqual(["openverse", "pexels", "searxng"]);
  });
});

describe("SearXNG image adapter", () => {
  it("normalizes image-category JSON without assuming the app contract", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      results: [
        { title: "Temple", url: "https://source.example/temple", img_src: "https://cdn.example/temple.jpg", thumbnail_src: "https://cdn.example/thumb.jpg" },
        { title: "No image", url: "https://source.example/no-image" },
      ],
    }));
    const provider = new SearxngImageSearchProvider("http://127.0.0.1:8888", { fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(provider.search({ query: "kyoto temple", limit: 2 })).resolves.toEqual([{
      imageUrl: "https://cdn.example/temple.jpg",
      sourceUrl: "https://source.example/temple",
      alt: "Temple",
    }]);
    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("categories")).toBe("images");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("safesearch")).toBe("2");
  });
});
