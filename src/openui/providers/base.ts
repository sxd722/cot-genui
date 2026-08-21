import type { ImageSearchProvider } from "../assetTypes";

export class ImageSearchProviderError extends Error {
  constructor(
    readonly stage: "provider-request" | "provider-response",
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ImageSearchProviderError";
  }
}

export class NoopImageSearchProvider implements ImageSearchProvider {
  readonly kind = "noop";
  async search() { return []; }
}

/**
 * Explicit custom endpoint contract:
 * POST {query, limit} -> {schemaVersion:"1", results:[{imageUrl, sourceUrl?, alt?, creator?, creatorUrl?, license?, licenseUrl?}]}.
 * Other response shapes are rejected instead of guessed.
 */
export class ContractImageSearchProvider implements ImageSearchProvider {
  readonly kind = "custom-http-v1";

  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string,
    private readonly options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  async search(args: { query: string; limit: number; signal?: AbortSignal }): Promise<unknown[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 5_000);
    const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(args),
        signal,
      });
    } catch (error) {
      throw new ImageSearchProviderError("provider-request", error instanceof Error ? error.message : "Image provider request failed");
    }
    if (!response.ok) {
      throw new ImageSearchProviderError("provider-response", `Image provider returned HTTP ${response.status}`, response.status);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ImageSearchProviderError("provider-response", "Image provider response is not valid JSON");
    }
    if (!value || typeof value !== "object" || (value as Record<string, unknown>).schemaVersion !== "1") {
      throw new ImageSearchProviderError("provider-response", "Image provider response must declare schemaVersion \"1\"");
    }
    const results = (value as Record<string, unknown>).results;
    if (!Array.isArray(results)) {
      throw new ImageSearchProviderError("provider-response", "Image provider response must contain a results array");
    }
    return results;
  }
}
