import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { CardPlan } from "@/dsl/modules";
import type { AssetManifest, AssetRecord, AssetRequest, ImageSearchProvider } from "./assetTypes";

export class NoopImageSearchProvider implements ImageSearchProvider {
  async search() { return []; }
}

export class HttpImageSearchProvider implements ImageSearchProvider {
  constructor(private readonly endpoint: string, private readonly apiKey?: string) {}

  async search(args: { query: string; limit: number }) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Image search HTTP ${response.status}`);
    const value = await response.json() as { images?: unknown[] };
    return (Array.isArray(value.images) ? value.images : []).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const image = item as Record<string, unknown>;
      if (typeof image.imageUrl !== "string") return [];
      return [{ imageUrl: image.imageUrl, ...(typeof image.sourceUrl === "string" ? { sourceUrl: image.sourceUrl } : {}), ...(typeof image.alt === "string" ? { alt: image.alt } : {}) }];
    }).slice(0, args.limit);
  }
}

function privateIpv4(value: string) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] >= 224;
}

function privateIpv6(value: string) {
  const normalized = value.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fe8") || normalized.startsWith("fe9")
    || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("fc") || normalized.startsWith("fd");
}

export function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  const family = isIP(normalized);
  return family === 4 ? privateIpv4(normalized) : family === 6 ? privateIpv6(normalized) : false;
}

async function safeHttpsUrl(value: string): Promise<URL | null> {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || isPrivateHostname(url.hostname)) return null;
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateHostname(entry.address))) return null;
  } catch { return null; }
  return url;
}

export async function validatePublicImageUrl(value: string): Promise<string | null> {
  let current = await safeHttpsUrl(value);
  if (!current) return null;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    try {
      const response = await fetch(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(2_500) });
      if (response.status >= 300 && response.status < 400) {
        if (redirects === 3) return null;
        const location = response.headers.get("location");
        if (!location) return null;
        current = await safeHttpsUrl(new URL(location, current).toString());
        if (!current) return null;
        continue;
      }
      if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("image/")) return null;
      return current.toString();
    } catch { return null; }
  }
  return null;
}

export function collectAssetRequests(cardPlan: CardPlan): AssetRequest[] {
  return cardPlan.cards.flatMap((card) => card.blocks.flatMap((block, blockIndex) => {
    if (!block.assetRequest) return [];
    const idBase = card.id.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "card";
    return [{ id: `asset_${idBase}_${blockIndex + 1}`, cardId: card.id, ...block.assetRequest }];
  }));
}

export async function resolveAssetManifest(
  cardPlan: CardPlan,
  options: { provider?: ImageSearchProvider; validate?: (url: string) => Promise<string | null> } = {},
): Promise<AssetManifest> {
  const requests = collectAssetRequests(cardPlan);
  const provider = options.provider ?? (process.env.IMAGE_SEARCH_API_URL
    ? new HttpImageSearchProvider(process.env.IMAGE_SEARCH_API_URL, process.env.IMAGE_SEARCH_API_KEY)
    : new NoopImageSearchProvider());
  const validate = options.validate ?? validatePublicImageUrl;
  const assets: AssetRecord[] = [];
  for (const request of requests) {
    let candidates: Awaited<ReturnType<ImageSearchProvider["search"]>> = [];
    try { candidates = await provider.search({ query: request.query, limit: request.count }); } catch { continue; }
    for (const [index, candidate] of candidates.slice(0, request.count).entries()) {
      const src = await validate(candidate.imageUrl);
      if (!src) continue;
      const id = request.count === 1 ? request.id : `${request.id}_${index + 1}`;
      assets.push({ id, kind: "image", src, alt: candidate.alt?.slice(0, 240) || request.query, ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}) });
    }
  }
  return { requests, assets };
}
