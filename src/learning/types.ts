import type { QueryClassification, AdaptivePolicyEntry, TaskFamily } from "../lib/adaptive/types";
import type { CardEditTarget, OpenUIEditVersion } from "../lib/cardEditingTypes";
import type { ModelProfile, PipelineStepName, TokenUsage } from "../lib/pipelineTypes";
import type { StepProvenance } from "../lib/provenance";
import type { ArtifactRecord, ExternalSkillMatcherModel, SkillCandidateRecord, SkillExecutionModel, SkillRecord, SkillStepReuseSettings, SkillVersionRecord, StepRunRecord, TaskRunRecord } from "./workflowTypes";

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
  metrics?: OpenUIEditVersion["metrics"];
}

export interface EpisodeFeedbackRecord {
  id: string;
  scope: "card-flow";
  text: string;
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
  /** 只供持久化与 Reflection 使用，不即时改写当前 CardPlan/OpenUI。 */
  feedback?: EpisodeFeedbackRecord[];
  finalOpenUI?: string;
  rewardMetrics?: {
    editCount: number;
    semanticEditCount: number;
    visualEditCount: number;
    undoCount: number;
    acceptedWithoutEdit: boolean;
    timeToAcceptMs: number;
    feedbackCount?: number;
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
  /** v2：旧 IndexedDB 记录缺失时由 storage 默认补为 true。 */
  skillReuseEnabled?: boolean;
  skillStepReuse?: SkillStepReuseSettings;
  skillMatchModel?: ExternalSkillMatcherModel;
  /** 用于 Skill 增量执行；两个配置都默认关闭 Thinking。 */
  skillExecutionModel?: SkillExecutionModel;
  updatedAt: string;
}

export interface LearningExport {
  schemaVersion: 2;
  exportedAt: string;
  episodes: GenerationEpisode[];
  policies: AdaptivePolicyEntry[];
  observations: PolicyObservation[];
  settings: LearningSettings;
  workflow: {
    taskRuns: TaskRunRecord[];
    stepRuns: StepRunRecord[];
    artifacts: ArtifactRecord[];
    skills: SkillRecord[];
    skillVersions: SkillVersionRecord[];
    skillCandidates: SkillCandidateRecord[];
  };
}
