import type { QueryClassification, AdaptivePolicyEntry, TaskFamily } from "@/lib/adaptive/types";
import type { CardEditTarget } from "@/lib/cardEditingTypes";
import type { ModelProfile, PipelineStepName, TokenUsage } from "@/lib/pipelineTypes";
import type { StepProvenance } from "@/lib/provenance";

export type EpisodeStatus = "generating" | "editing" | "accepted" | "abandoned";

export interface EpisodeStepRecord {
  step: PipelineStepName;
  modelProfile?: ModelProfile;
  policyId?: string;
  policyVersion?: number;
  steeringHint?: string;
  provenance?: StepProvenance;
  usage?: TokenUsage;
  recordedAt: string;
}

export interface EpisodeEditRecord {
  versionId: string;
  cardId: string;
  instruction: string;
  target: CardEditTarget;
  beforeSlice: string;
  afterSlice: string;
  modelProfile: ModelProfile;
  createdAt: string;
}

export interface GenerationEpisode {
  id: string;
  schemaVersion: 1;
  query: string;
  queryClassification: QueryClassification;
  userKey?: string;
  status: EpisodeStatus;
  startedAt: string;
  updatedAt: string;
  acceptedAt?: string;
  abandonedAt?: string;
  profileViewSummary?: {
    charCount: number;
    selectedDomains: string[];
    selectedDetailCount: number;
  };
  steps: Partial<Record<PipelineStepName, EpisodeStepRecord>>;
  initialOpenUI?: {
    code: string;
    cardCount: number;
    recordedAt: string;
  };
  edits: EpisodeEditRecord[];
  finalOpenUI?: string;
  rewardMetrics?: {
    editCount: number;
    semanticEditCount: number;
    visualEditCount: number;
    undoCount: number;
    acceptedWithoutEdit: boolean;
    timeToAcceptMs: number;
  };
}

export interface PolicyObservation {
  id: string;
  episodeId: string;
  taskFamily: TaskFamily;
  userKey?: string;
  target: "profileOverlay" | PipelineStepName;
  themeKey: string;
  candidateText: string;
  confidence: number;
  attributionProbability: number;
  decision: "pending" | "applied" | "discarded" | "auto-applied";
  policyId?: string;
  createdAt: string;
}

export interface LearningSettings {
  id: "settings";
  enabled: boolean;
  learningMode: "manual" | "guarded-auto";
  updatedAt: string;
}

export interface LearningExport {
  exportedAt: string;
  episodes: GenerationEpisode[];
  policies: AdaptivePolicyEntry[];
  observations: PolicyObservation[];
  settings: LearningSettings;
}
