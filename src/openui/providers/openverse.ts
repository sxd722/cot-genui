import type { ImageCandidate, ImageSearchProvider } from "../assetTypes";

interface OpenverseResult {
  url?: string;
  title?: string;
  foreign_landing_url?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
}

/**
 * Openverse image search (https://api.openverse.org/v1/images/). No API key
 * required for the standard rate limit, which makes it the default no-key
 * fallback. Only fields actually returned by the API are mapped.
 */
export class OpenverseImageSearchProvider implements ImageSearchProvider {
  readonly kind = "openverse";

  constructor(
    private readonly options: {
      fetchImpl?: typeof fetch;
      endpoint?: string;
      timeoutMs?: number;
    } = {},
  ) {}

  async search(args: { query: string; limit: number; signal?: AbortSignal }): Promise<ImageCandidate[]> {
    const url = new URL(this.options.endpoint ?? "https://api.openverse.org/v1/images/");
    url.searchParams.set("q", args.query);
    url.searchParams.set("page_size", String(Math.min(Math.max(args.limit, 1), 20)));

    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 5_000);
    const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
    const response = await (this.options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Openverse HTTP ${response.status}`);
    }
    const data = await response.json() as { results?: OpenverseResult[] };
    return (data.results ?? []).flatMap((result) => result.url ? [{
      imageUrl: result.url,
      sourceUrl: result.foreign_landing_url,
      alt: result.title?.trim() || undefined,
      creator: result.creator,
      creatorUrl: result.creator_url,
      license: [result.license, result.license_version].filter(Boolean).join(" ").trim() || undefined,
      licenseUrl: result.license_url,
    }] : []);
  }
}
