import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const hmac = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("hex");

export function canonicalSignature(timestamp: string, method: string, path: string, body: string) {
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${sha256(body)}`;
}

export function verifyHmac(secret: string, timestamp: string, signature: string, method: string, path: string, body: string): boolean {
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false;
  const expected = hmac(secret, canonicalSignature(timestamp, method, path, body));
  const left = Buffer.from(expected);
  const right = Buffer.from(signature || "");
  return left.length === right.length && timingSafeEqual(left, right);
}
