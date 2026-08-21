import type { ImageCandidate, ImageSearchProvider } from "../../src/openui/assetTypes";

interface SearxngResult {
  title?: unknown;
  url?: unknown;
  img_src?: unknown;
  thumbnail_src?: unknown;
  thumbnail?: unknown;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function searchEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  if (!url.pathname.endsWith("/search")) url.pathname = `${url.pathname.replace(/\/$/, "")}/search`;
  return url;
}

/** Normalizes SearXNG's image-category JSON into the host ImageCandidate contract. */
export class SearxngImageSearchProvider implements ImageSearchProvider {
  readonly kind = "searxng";

  constructor(
    private readonly endpoint: string,
    private readonly options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  async search(args: { query: string; limit: number; signal?: AbortSignal }): Promise<ImageCandidate[]> {
    const url = searchEndpoint(this.endpoint);
    url.searchParams.set("q", args.query);
    url.searchParams.set("categories", "images");
    url.searchParams.set("format", "json");
    url.searchParams.set("safesearch", "2");

    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 5_000);
    const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
    const response = await (this.options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
    const data = await response.json() as { results?: SearxngResult[] };
    return (data.results ?? []).flatMap((result) => {
      const imageUrl = text(result.img_src) ?? text(result.thumbnail_src) ?? text(result.thumbnail);
      if (!imageUrl) return [];
      return [{
        imageUrl,
        ...(text(result.url) ? { sourceUrl: text(result.url) } : {}),
        ...(text(result.title) ? { alt: text(result.title) } : {}),
      }];
    }).slice(0, Math.min(Math.max(args.limit, 1), 6));
  }
}
