import type { CardPlan } from "@/dsl/modules";

export const CARD_EDIT_MODEL_PROFILES = ["glm_5_2", "glm_4_7_flash"] as const;
export type CardEditModelProfile = (typeof CARD_EDIT_MODEL_PROFILES)[number];

export function isCardEditModelProfile(value: unknown): value is CardEditModelProfile {
  return typeof value === "string" && (CARD_EDIT_MODEL_PROFILES as readonly string[]).includes(value);
}

export interface CardEditTarget {
  cardId: string;
  x: number;
  y: number;
  pixelX: number;
  pixelY: number;
  nearbyText: string;
  elementHint: string;
}

export interface OpenUIEditVersion {
  id: string;
  createdAt: string;
  code: string;
  instruction?: string;
  target?: CardEditTarget;
  modelProfile?: CardEditModelProfile;
  beforeSlice?: string;
  afterSlice?: string;
  metrics?: { promptChars: number; patchChars: number; latencyMs: number };
}

export interface OpenUIEditRequest {
  currentCode: string;
  cardPlan: CardPlan;
  cardPlanMarkdown: string;
  cardId: string;
  target: CardEditTarget;
  instruction: string;
  modelProfile: CardEditModelProfile;
}
