import type { ImageCandidate, ImageSearchProvider } from "../assetTypes";

interface PexelsPhoto {
  url?: string;
  alt?: string;
  photographer?: string;
  photographer_url?: string;
  src?: { landscape?: string; large?: string; medium?: string };
}

/**
 * Pexels image search. Free tier key from https://www.pexels.com/api/.
 * Only fields actually returned by the API are mapped.
 */
export class PexelsImageSearchProvider implements ImageSearchProvider {
  readonly kind = "pexels";

  constructor(
    private readonly apiKey: string,
    private readonly options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  async search(args: { query: string; limit: number; signal?: AbortSignal }): Promise<ImageCandidate[]> {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", args.query);
    url.searchParams.set("per_page", String(Math.min(Math.max(args.limit, 1), 15)));

    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 5_000);
    const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
    const response = await (this.options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { Authorization: this.apiKey },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Pexels HTTP ${response.status}`);
    }
    const data = await response.json() as { photos?: PexelsPhoto[] };
    return (data.photos ?? [])
      .map((photo) => ({
        imageUrl: photo.src?.landscape ?? photo.src?.large ?? photo.src?.medium ?? "",
        sourceUrl: photo.url,
        alt: photo.alt,
        creator: photo.photographer,
        creatorUrl: photo.photographer_url,
      }))
      .filter((item) => !!item.imageUrl);
  }
}
