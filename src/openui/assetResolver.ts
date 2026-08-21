import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { CardPlan } from "@/dsl/modules";
import type {
  AssetProviderState,
  AssetRecord,
  AssetRequest,
  AssetResolutionDiagnosticEvent,
  AssetResolutionResult,
  ImageSearchProvider,
} from "./assetTypes";

interface ImageCandidate {
  imageUrl: string;
  sourceUrl?: string;
  alt?: string;
}

export interface ImageUrlValidationSuccess { ok: true; url: string }
export interface ImageUrlValidationFailure {
  ok: false;
  stage: AssetResolutionDiagnosticEvent["stage"];
  reason: string;
  statusCode?: number;
}
export type ImageUrlValidationResult = ImageUrlValidationSuccess | ImageUrlValidationFailure;

export interface UrlValidationOptions {
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  timeoutMs?: number;
  maxRedirects?: number;
}

type AssetValidator = (url: string) => Promise<ImageUrlValidationResult | string | null>;

export interface ResolveAssetOptions {
  provider?: ImageSearchProvider;
  validate?: AssetValidator;
  env?: Record<string, string | undefined>;
}

class ImageSearchProviderError extends Error {
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
 * POST {query, limit} -> {schemaVersion:"1", results:[{imageUrl, sourceUrl?, alt?}]}.
 * Other response shapes are rejected instead of guessed.
 */
export class ContractImageSearchProvider implements ImageSearchProvider {
  readonly kind = "custom-http-v1";

  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string,
    private readonly options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  async search(args: { query: string; limit: number }): Promise<unknown[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
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

/** @deprecated Use ContractImageSearchProvider. */
export const HttpImageSearchProvider = ContractImageSearchProvider;

function privateIpv4(value: string) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2))
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || (parts[1] === 51 && parts[2] === 100)))
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
    || parts[0] >= 224;
}

function privateIpv6(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("::ffff:")) return privateIpv4(normalized.slice("::ffff:".length));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fe8") || normalized.startsWith("fe9")
    || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("fec") || normalized.startsWith("fed")
    || normalized.startsWith("fee") || normalized.startsWith("fef") || normalized.startsWith("fc") || normalized.startsWith("fd")
    || normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
}

export function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  const family = isIP(normalized);
  return family === 4 ? privateIpv4(normalized) : family === 6 ? privateIpv6(normalized) : false;
}

async function inspectHttpsUrl(value: string, options: UrlValidationOptions): Promise<ImageUrlValidationResult> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, stage: "url-parse", reason: "Candidate is not a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, stage: "url-policy", reason: "Candidate URL must use HTTPS" };
  if (url.username || url.password) return { ok: false, stage: "url-policy", reason: "Candidate URL must not contain credentials" };
  if (isPrivateHostname(url.hostname)) return { ok: false, stage: "url-policy", reason: "Candidate URL targets a private or local hostname" };
  const lookupImpl = options.lookupImpl ?? (async (hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  try {
    const addresses = await lookupImpl(url.hostname);
    if (!addresses.length) return { ok: false, stage: "dns", reason: "Candidate hostname resolved to no addresses" };
    if (addresses.some((entry) => isPrivateHostname(entry.address))) {
      return { ok: false, stage: "dns", reason: "Candidate hostname resolves to a private or reserved address" };
    }
  } catch (error) {
    return { ok: false, stage: "dns", reason: error instanceof Error ? `DNS lookup failed: ${error.message}` : "DNS lookup failed" };
  }
  return { ok: true, url: url.toString() };
}

function imageContentType(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().startsWith("image/") ?? false;
}

function redirectLocation(response: Response, current: URL): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  try { return new URL(location, current).toString(); } catch { return null; }
}

export async function validatePublicImageUrlDetailed(value: string, options: UrlValidationOptions = {}): Promise<ImageUrlValidationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_500;
  const maxRedirects = options.maxRedirects ?? 3;
  let inspected = await inspectHttpsUrl(value, options);
  if (!inspected.ok) return inspected;
  let current = new URL(inspected.url);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let head: Response | undefined;
    let headError: string | undefined;
    try {
      head = await fetchImpl(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      headError = error instanceof Error ? error.message : "HEAD request failed";
    }

    if (head && head.status >= 300 && head.status < 400) {
      if (redirects === maxRedirects) return { ok: false, stage: "redirect", reason: "Too many image redirects", statusCode: head.status };
      const location = redirectLocation(head, current);
      if (!location) return { ok: false, stage: "redirect", reason: "Image redirect is missing a valid location", statusCode: head.status };
      inspected = await inspectHttpsUrl(location, options);
      if (!inspected.ok) return { ...inspected, stage: "redirect", reason: `Unsafe redirect: ${inspected.reason}` };
      current = new URL(inspected.url);
      continue;
    }
    if (head?.ok && imageContentType(head)) return { ok: true, url: current.toString() };
    if (head?.ok && head.headers.has("content-type")) {
      return { ok: false, stage: "head", reason: `HEAD content-type is not an image: ${head.headers.get("content-type")}`, statusCode: head.status };
    }
    const shouldFallback = !!headError || !head?.headers.has("content-type") || [403, 405, 501].includes(head?.status ?? 0);
    if (!shouldFallback) {
      return { ok: false, stage: "head", reason: `HEAD probe returned HTTP ${head?.status ?? "unknown"}`, statusCode: head?.status };
    }

    let getResponse: Response;
    try {
      getResponse = await fetchImpl(current, {
        method: "GET",
        headers: { Range: "bytes=0-1023" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { ok: false, stage: "get-fallback", reason: error instanceof Error ? `Range GET failed: ${error.message}` : "Range GET failed" };
    }
    if (getResponse.status >= 300 && getResponse.status < 400) {
      void getResponse.body?.cancel();
      if (redirects === maxRedirects) return { ok: false, stage: "redirect", reason: "Too many image redirects", statusCode: getResponse.status };
      const location = redirectLocation(getResponse, current);
      if (!location) return { ok: false, stage: "redirect", reason: "Image redirect is missing a valid location", statusCode: getResponse.status };
      inspected = await inspectHttpsUrl(location, options);
      if (!inspected.ok) return { ...inspected, stage: "redirect", reason: `Unsafe redirect: ${inspected.reason}` };
      current = new URL(inspected.url);
      continue;
    }
    const validImage = getResponse.ok && imageContentType(getResponse);
    void getResponse.body?.cancel();
    if (validImage) return { ok: true, url: current.toString() };
    return {
      ok: false,
      stage: "get-fallback",
      reason: getResponse.ok
        ? `Range GET content-type is not an image: ${getResponse.headers.get("content-type") ?? "missing"}`
        : `Range GET returned HTTP ${getResponse.status}`,
      statusCode: getResponse.status,
    };
  }
  return { ok: false, stage: "redirect", reason: "Too many image redirects" };
}

export async function validatePublicImageUrl(value: string, options: UrlValidationOptions = {}): Promise<string | null> {
  const result = await validatePublicImageUrlDetailed(value, options);
  return result.ok ? result.url : null;
}

export function collectAssetRequests(cardPlan: CardPlan): AssetRequest[] {
  return cardPlan.cards.flatMap((card) => card.blocks.flatMap((block, blockIndex) => {
    if (!block.assetRequest) return [];
    const idBase = card.id.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "card";
    return [{ id: `asset_${idBase}_${blockIndex + 1}`, cardId: card.id, ...block.assetRequest }];
  }));
}

function diagnosticEvent(error: unknown, requestId: string): AssetResolutionDiagnosticEvent {
  if (error instanceof ImageSearchProviderError) {
    return { stage: error.stage, reason: error.message, requestId, ...(error.statusCode ? { statusCode: error.statusCode } : {}) };
  }
  return { stage: "provider-request", reason: error instanceof Error ? error.message : String(error), requestId };
}

function parseCandidate(value: unknown): ImageCandidate | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.imageUrl !== "string" || !record.imageUrl.trim()) return null;
  return {
    imageUrl: record.imageUrl,
    ...(typeof record.sourceUrl === "string" ? { sourceUrl: record.sourceUrl } : {}),
    ...(typeof record.alt === "string" ? { alt: record.alt } : {}),
  };
}

async function validateCandidate(validate: AssetValidator, url: string): Promise<ImageUrlValidationResult> {
  try {
    const value = await validate(url);
    if (typeof value === "string") return { ok: true, url: value };
    if (value && typeof value === "object" && "ok" in value) return value;
    return { ok: false, stage: "url-policy", reason: "Candidate URL validation rejected the image" };
  } catch (error) {
    return { ok: false, stage: "url-policy", reason: error instanceof Error ? `Candidate validator failed: ${error.message}` : "Candidate validator failed" };
  }
}

function finalProviderState(args: { noop: boolean; requests: number; candidates: number; accepted: number; providerErrors: number }): AssetProviderState {
  if (args.noop) return "noop-unconfigured";
  if (args.requests === 0) return "configured";
  if (args.accepted > 0) return "ready";
  if (args.providerErrors > 0) return "provider-error";
  if (args.candidates === 0) return "zero-results";
  return "validation-rejected";
}

export function disabledAssetResolution(cardPlan: CardPlan): AssetResolutionResult {
  const requests = collectAssetRequests(cardPlan);
  return {
    manifest: { requests, assets: [] },
    diagnostics: {
      providerState: "disabled",
      providerKind: "disabled",
      requests: requests.length,
      candidates: 0,
      accepted: 0,
      rejected: 0,
      events: [{ stage: "configuration", reason: "OpenUI host-owned assets are disabled by feature flag" }],
    },
  };
}

export async function resolveAssetManifest(cardPlan: CardPlan, options: ResolveAssetOptions = {}): Promise<AssetResolutionResult> {
  const requests = collectAssetRequests(cardPlan);
  const env = options.env ?? process.env;
  const configuredEndpoint = env.IMAGE_SEARCH_API_URL?.trim();
  const provider = options.provider ?? (configuredEndpoint
    ? new ContractImageSearchProvider(configuredEndpoint, env.IMAGE_SEARCH_API_KEY, { timeoutMs: Number(env.IMAGE_SEARCH_TIMEOUT_MS) || 5_000 })
    : new NoopImageSearchProvider());
  const noop = provider instanceof NoopImageSearchProvider || provider.kind === "noop";
  const validate: AssetValidator = options.validate ?? ((url) => validatePublicImageUrlDetailed(url));
  const assets: AssetRecord[] = [];
  const events: AssetResolutionDiagnosticEvent[] = [];
  let candidates = 0;
  let rejected = 0;
  let providerErrors = 0;

  if (noop) events.push({ stage: "configuration", reason: "IMAGE_SEARCH_API_URL is not configured; NoopImageSearchProvider is active" });

  for (const request of requests) {
    if (noop) continue;
    let rawCandidates: unknown[];
    try {
      rawCandidates = await provider.search({ query: request.query, limit: request.count });
      if (!Array.isArray(rawCandidates)) throw new ImageSearchProviderError("provider-response", "Image provider search result must be an array");
    } catch (error) {
      providerErrors += 1;
      events.push(diagnosticEvent(error, request.id));
      continue;
    }
    let acceptedForRequest = 0;
    for (const [candidateIndex, rawCandidate] of rawCandidates.entries()) {
      candidates += 1;
      if (candidateIndex >= request.count) {
        rejected += 1;
        events.push({ stage: "candidate-limit", reason: `Provider returned more than requested limit ${request.count}`, requestId: request.id, candidateIndex });
        continue;
      }
      const candidate = parseCandidate(rawCandidate);
      if (!candidate) {
        rejected += 1;
        events.push({ stage: "provider-response", reason: "Candidate must contain a non-empty imageUrl", requestId: request.id, candidateIndex });
        continue;
      }
      const validation = await validateCandidate(validate, candidate.imageUrl);
      if (!validation.ok) {
        rejected += 1;
        events.push({
          stage: validation.stage,
          reason: validation.reason,
          requestId: request.id,
          candidateIndex,
          ...(validation.statusCode ? { statusCode: validation.statusCode } : {}),
        });
        continue;
      }
      acceptedForRequest += 1;
      const id = request.count === 1 ? request.id : `${request.id}_${acceptedForRequest}`;
      assets.push({
        id,
        kind: "image",
        src: validation.url,
        alt: candidate.alt?.slice(0, 240) || request.query,
        ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
      });
    }
  }

  return {
    manifest: { requests, assets },
    diagnostics: {
      providerState: finalProviderState({ noop, requests: requests.length, candidates, accepted: assets.length, providerErrors }),
      providerKind: provider.kind ?? "injected",
      requests: requests.length,
      candidates,
      accepted: assets.length,
      rejected,
      events,
    },
  };
}
