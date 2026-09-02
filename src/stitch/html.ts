import "server-only";

export const MAX_STITCH_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 30_000;

function assertHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Stitch HTML download URL must use HTTPS");
  const hostname = url.hostname.toLowerCase();
  const trusted = ["google.com", "googleusercontent.com", "googleapis.com", "gstatic.com"]
    .some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (!trusted) throw new Error("Stitch download URL is not hosted by an allowed Google domain");
  return url;
}

export function isTrustedStitchUrl(value: string): boolean {
  try {
    assertHttpsUrl(value);
    return true;
  } catch {
    return false;
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<{ source: string; bytes: number }> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Stitch HTML exceeds ${maxBytes} bytes`);
  }
  if (!response.body) throw new Error("Stitch HTML response has no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error(`Stitch HTML exceeds ${maxBytes} bytes`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { source: new TextDecoder().decode(merged), bytes };
}

export async function fetchStitchHtmlSource(
  downloadUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ source: string; bytes: number }> {
  let current = assertHttpsUrl(downloadUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === MAX_REDIRECTS) throw new Error("Stitch HTML redirect limit exceeded");
        current = assertHttpsUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`Stitch HTML download failed with HTTP ${response.status}`);
      const result = await readBoundedText(response, MAX_STITCH_HTML_BYTES);
      if (!/<!doctype\s+html|<html(?:\s|>)/i.test(result.source) || result.source.includes("\0")) {
        throw new Error("Stitch download did not contain a valid HTML document");
      }
      return result;
    }
    throw new Error("Stitch HTML redirect limit exceeded");
  } finally {
    clearTimeout(timeout);
  }
}
