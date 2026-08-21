import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { ImageCandidate, ImageSearchProvider } from "../../src/openui/assetTypes";
import { OpenverseImageSearchProvider, PexelsImageSearchProvider } from "../../src/openui/providers";
import { SearxngImageSearchProvider } from "./searxng";

const MAX_BODY_BYTES = 16 * 1024;
const CANDIDATE_FIELDS = ["imageUrl", "sourceUrl", "alt", "creator", "creatorUrl", "license", "licenseUrl"] as const;

interface GatewaySearchInput {
  query: string;
  limit: number;
}

interface ProviderAttempt {
  provider: string;
  state: "error" | "zero-results" | "ready";
}

export interface ImageGatewayServerOptions {
  providers?: ImageSearchProvider[];
  apiKey?: string;
  env?: Record<string, string | undefined>;
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function authorized(request: IncomingMessage, apiKey: string | undefined): boolean {
  if (!apiKey) return true;
  const actual = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(apiKey);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("request body exceeds 16 KiB");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

function parseInput(value: unknown): GatewaySearchInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const query = typeof record.query === "string" ? record.query.trim() : "";
  const limit = typeof record.limit === "number" ? record.limit : Number(record.limit);
  if (!query || query.length > 300 || !Number.isInteger(limit) || limit < 1 || limit > 6) return null;
  return { query, limit };
}

function normalizeCandidates(values: unknown[], limit: number): ImageCandidate[] {
  const seen = new Set<string>();
  const results: ImageCandidate[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl.trim() : "";
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    const candidate = { imageUrl } as Record<string, string>;
    for (const field of CANDIDATE_FIELDS.slice(1)) {
      if (typeof record[field] === "string" && record[field].trim()) candidate[field] = record[field].trim();
    }
    results.push(candidate as unknown as ImageCandidate);
    if (results.length >= limit) break;
  }
  return results;
}

async function searchProviders(providers: ImageSearchProvider[], input: GatewaySearchInput) {
  const attempts: ProviderAttempt[] = [];
  for (const provider of providers) {
    const providerKind = provider.kind ?? "unknown";
    try {
      const raw = await provider.search(input);
      const results = normalizeCandidates(Array.isArray(raw) ? raw : [], input.limit);
      if (results.length) {
        attempts.push({ provider: providerKind, state: "ready" });
        return { results, provider: providerKind, attempts };
      }
      attempts.push({ provider: providerKind, state: "zero-results" });
    } catch {
      attempts.push({ provider: providerKind, state: "error" });
    }
  }
  return { results: [] as ImageCandidate[], provider: "none", attempts };
}

function providerOrder(env: Record<string, string | undefined>): string[] {
  const explicit = env.IMAGE_GATEWAY_PROVIDERS?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return explicit?.length ? explicit : ["pexels", "openverse", "searxng"];
}

export function createGatewayProviders(env: Record<string, string | undefined> = process.env): ImageSearchProvider[] {
  const providers: ImageSearchProvider[] = [];
  const pexelsKey = env.IMAGE_GATEWAY_PEXELS_API_KEY?.trim() || env.PEXELS_API_KEY?.trim();
  const searxngUrl = env.IMAGE_GATEWAY_SEARXNG_URL?.trim();
  for (const name of providerOrder(env)) {
    if (name === "pexels" && pexelsKey) providers.push(new PexelsImageSearchProvider(pexelsKey));
    else if (name === "openverse") providers.push(new OpenverseImageSearchProvider());
    else if (name === "searxng" && searxngUrl) providers.push(new SearxngImageSearchProvider(searxngUrl));
  }
  return providers;
}

export function createImageGatewayServer(options: ImageGatewayServerOptions = {}): Server {
  const env = options.env ?? process.env;
  const providers = options.providers ?? createGatewayProviders(env);
  const apiKey = options.apiKey ?? env.IMAGE_GATEWAY_API_KEY?.trim();
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://image-gateway.local");
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, providers.length ? 200 : 503, {
        status: providers.length ? "ok" : "unconfigured",
        schemaVersion: "1",
        providers: providers.map((provider) => provider.kind ?? "unknown"),
      });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/search") {
      json(response, 404, { error: "not_found" });
      return;
    }
    if (!authorized(request, apiKey)) {
      json(response, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
      return;
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      json(response, 415, { error: "content_type_must_be_application_json" });
      return;
    }
    if (!providers.length) {
      json(response, 503, { error: "no_image_provider_configured" });
      return;
    }
    try {
      const input = parseInput(await readJson(request));
      if (!input) {
        json(response, 400, { error: "query must be 1-300 chars and limit must be an integer from 1 to 6" });
        return;
      }
      const outcome = await searchProviders(providers, input);
      json(response, 200, { schemaVersion: "1", results: outcome.results }, {
        "X-Image-Provider": outcome.provider,
        "X-Image-Provider-Attempts": outcome.attempts.map((attempt) => `${attempt.provider},${attempt.state}`).join(";"),
      });
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : "invalid_request" });
    }
  });
}

function isMainModule(): boolean {
  return !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMainModule()) {
  const host = process.env.IMAGE_GATEWAY_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.IMAGE_GATEWAY_PORT) || 4010;
  const server = createImageGatewayServer();
  server.listen(port, host, () => {
    const providers = createGatewayProviders().map((provider) => provider.kind).join(" → ") || "none";
    process.stdout.write(`Image Gateway listening on http://${host}:${port} (${providers})\n`);
  });
}
