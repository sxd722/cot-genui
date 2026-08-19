import type { ModelProfile } from "@/lib/pipelineTypes";
import type { CardPlan } from "@/dsl/modules";

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
  modelProfile?: ModelProfile;
  beforeSlice?: string;
  afterSlice?: string;
}

export interface OpenUIEditRequest {
  currentCode: string;
  cardPlan: CardPlan;
  cardPlanMarkdown: string;
  cardId: string;
  target: CardEditTarget;
  instruction: string;
  modelProfile: ModelProfile;
}
