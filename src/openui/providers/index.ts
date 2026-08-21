import type { ImageSearchProvider } from "../assetTypes";
import { ContractImageSearchProvider, NoopImageSearchProvider } from "./base";
import { OpenverseImageSearchProvider } from "./openverse";
import { PexelsImageSearchProvider } from "./pexels";

export { ContractImageSearchProvider, ImageSearchProviderError, NoopImageSearchProvider } from "./base";
export { OpenverseImageSearchProvider } from "./openverse";
export { PexelsImageSearchProvider } from "./pexels";

/**
 * Provider chain, in fallback order:
 *   custom-http-v1 (explicit opt-in) → Pexels (key) → Openverse (no-key default) → Noop.
 * A provider later in the chain is only used when earlier ones fail or return
 * nothing usable; Openverse can be disabled with OPENVERSE_IMAGES=off.
 */
export function createImageSearchProviders(env: Record<string, string | undefined>): ImageSearchProvider[] {
  const providers: ImageSearchProvider[] = [];

  const customEndpoint = env.IMAGE_SEARCH_API_URL?.trim();
  if (customEndpoint) {
    providers.push(new ContractImageSearchProvider(customEndpoint, env.IMAGE_SEARCH_API_KEY, {
      timeoutMs: Number(env.IMAGE_SEARCH_TIMEOUT_MS) || 5_000,
    }));
  }

  if (env.PEXELS_API_KEY) {
    providers.push(new PexelsImageSearchProvider(env.PEXELS_API_KEY));
  }

  if (env.OPENVERSE_IMAGES !== "off") {
    providers.push(new OpenverseImageSearchProvider());
  }

  if (!providers.length) {
    providers.push(new NoopImageSearchProvider());
  }

  return providers;
}
