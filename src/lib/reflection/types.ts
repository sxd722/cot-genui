import type { QueryClassification, TaskFamily } from "@/lib/adaptive/types";
import type { CardEditTarget } from "@/lib/cardEditingTypes";
import type { PipelineStepName } from "@/lib/pipelineTypes";

export const EDIT_INTENTS = [
  "visual", "layout", "interaction", "content_rewrite", "content_add", "content_remove",
  "fact_correction", "priority_change", "card_structure", "goal_correction",
] as const;
export type EditIntent = (typeof EDIT_INTENTS)[number];

export const ATTRIBUTION_TARGETS = ["profile", "step1", "step2", "step3", "step4", "step5", "step6"] as const;
export type AttributionTarget = (typeof ATTRIBUTION_TARGETS)[number];
export type AttributionDistribution = Record<AttributionTarget, number>;

export interface AttributionReport {
  editIntents: EditIntent[];
  distribution: AttributionDistribution;
  topTargets: Array<{ target: AttributionTarget; probability: number; evidence: string[] }>;
  reasonCodes: string[];
  modelUsed: boolean;
  entropy: number;
}

export interface ReflectionEpisodeView {
  query: string;
  classification: QueryClassification;
  profile: { overlay?: string; selectedDetails: Array<{ ref: string; text: string }> };
  step1: { taskType?: string; requirements: string[]; retrievalRequests: string[] };
  step2: { slots: string[]; sourceRefs: string[] };
  step3: { questions: string[] };
  step4: { summary?: string; assumptions: string[] };
  step5: { cardPlanMarkdown?: string };
  step6: { relevantInitialCardSlices: string[] };
  edits: Array<{ cardId: string; target: CardEditTarget; instruction: string; beforeCardSlice: string; afterCardSlice: string }>;
}

export interface PolicyGradientCandidate {
  id: string;
  taskFamily: TaskFamily;
  userKey?: string;
  target: "profileOverlay" | PipelineStepName;
  themeKey: string;
  previousText: string;
  candidateText: string;
  confidence: number;
  attributionProbability: number;
  scopeSuggestion: "class" | "user-class";
  rationaleSummary: string[];
}

