import type { CardPresentationIntent } from "@/dsl/modules";

const ARCHETYPES = new Set(["standard", "hero", "editorial", "comparison", "timeline", "data", "action", "media"]);
const DENSITIES = new Set(["compact", "balanced", "immersive"]);
const EMPHASES = new Set(["content", "data", "media", "action"]);

export function normalizeCardPresentation(value: unknown): CardPresentationIntent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.archetype !== "string" || !ARCHETYPES.has(raw.archetype)) return undefined;
  if (raw.density !== undefined && (typeof raw.density !== "string" || !DENSITIES.has(raw.density))) return undefined;
  if (raw.emphasis !== undefined && (typeof raw.emphasis !== "string" || !EMPHASES.has(raw.emphasis))) return undefined;
  return {
    archetype: raw.archetype as CardPresentationIntent["archetype"],
    ...(raw.density ? { density: raw.density as CardPresentationIntent["density"] } : {}),
    ...(raw.emphasis ? { emphasis: raw.emphasis as CardPresentationIntent["emphasis"] } : {}),
  };
}
