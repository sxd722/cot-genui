import type { DecisionMode, TaskFamily } from "../lib/adaptive/types";
import type { CardLayoutMode, CardPresentationArchetype, IRActionType } from "../dsl/modules";
import type { ModelProfile, PipelineStepName, StepTiming, TokenUsage } from "../lib/pipelineTypes";

export type TaskRunStatus = "running" | "waiting-clarification" | "completed" | "accepted" | "abandoned" | "failed";
export type SkillCandidateStatus = "ineligible" | "pending-comparison" | "new-skill" | "updated-skill" | "forked" | "discarded";
export type SkillExecutionMode = "normal" | "guided" | "deterministic" | "fallback";
export type SkillMatchActivation = "auto" | "suggested" | "manual";
export type SkillMatcherVersion = "local-lexical-v1" | "external-llm-v1";
export type ExternalSkillMatcherModel = "groq_qwen_3_6_27b" | "glm_5_2";
export type SkillExecutionModel = "groq_qwen_3_6_27b" | "glm_4_7_flash";

export type ReuseTier =
  | "exact-replay"
  | "relevant-exact"
  | "profile-compatible"
  | "skill-only"
  | "cold";

export type StepExecutionStrategy =
  | "replay"
  | "program-patch"
  | "deterministic"
  | "weak-delta"
  | "weak-full"
  | "strong-fallback";

export interface RuntimeCompatibilityV1 {
  pipelineVersion: string;
  promptSetHash: string;
  openuiSpecHash: string;
  featureFlagsHash: string;
}

export interface ProfileDependencyManifest {
  formatVersion: "genui-profile-dependencies/1";
  fullContextHash: string;
  relevantFingerprint: string;
  hardConstraintFingerprint: string;
  domains: string[];
  retrievalKeys: string[];
  selectors: string[];
  hardConstraintKeys: string[];
  /** Private snapshot-only values used to compare a later local profile. */
  relevantValues: Record<string, unknown>;
  hardConstraintValues: Record<string, unknown>;
  softValues: Record<string, unknown>;
}

export interface SkillExecutionCapsuleV1 {
  formatVersion: "genui-skill-capsule/1";
  recipeFingerprint: string;
  compatibility: RuntimeCompatibilityV1;
  intent: SkillIntentTemplate;
  profileDependencies: {
    domains: string[];
    retrievalKeys: string[];
    selectors: string[];
    hardConstraintKeys: string[];
  };
  stepContracts: Array<{
    step: PipelineStepName;
    reusable: boolean;
    requiredInputs: string[];
    weakModelHint?: string;
  }>;
  cardPlanTemplate: SkillRecipeV3["cardPlanRecipe"];
  openuiTemplate: SkillRecipeV3["openuiRecipe"];
  validators: string[];
}

export interface ReuseSnapshotV1 {
  id: string;
  formatVersion: "genui-reuse-snapshot/1";
  sourceRunId: string;
  skillId?: string;
  skillVersionId?: string;
  queryFingerprint: string;
  contextFingerprint: string;
  relevantProfileFingerprint: string;
  invocationFingerprint: string;
  /** Generic Skill identity without concrete runtime parameter values. */
  genericInvocationFingerprint?: string;
  layoutMode: CardLayoutMode;
  compatibility: RuntimeCompatibilityV1;
  compatibilityHash: string;
  requiresFreshData: boolean;
  expiresAt?: string;
  profileDependencyManifest: ProfileDependencyManifest;
  artifact: {
    queryAbstraction?: QueryAbstractionV1;
    inferenceState: import("../lib/pipelineTypes").InferenceState;
    cardPlan: import("../dsl/modules").CardPlan;
    cardPlanMarkdown: string;
    openuiCode: string;
    reasoningGraph?: string;
    result?: unknown;
    assetManifest?: import("../openui/assetTypes").AssetManifest;
    openuiDiagnostics?: unknown;
    steps?: Partial<Record<PipelineStepName, {
      reasoning: string;
      outputs: Record<string, unknown>;
      durationMs: number;
      model?: string;
      modelProfile?: ModelProfile;
      usage?: TokenUsage;
    }>>;
  };
  validation: {
    accepted: boolean;
    topology: boolean;
    actions: boolean;
    assets: boolean;
    rawUrls: boolean;
    layout: boolean;
  };
  baseline: { durationMs: number; promptTokens: number; completionTokens: number };
  createdAt: string;
}

export type ReuseDecisionCode =
  | "no-accepted-snapshot"
  | "query-match"
  | "context-match"
  | "context-relevant-match"
  | "context-compatible"
  | "context-conflict"
  | "layout-mismatch"
  | "runtime-mismatch"
  | "freshness-stale"
  | "validation-rejected"
  | "ready";

export interface ReuseDecisionTrace {
  code: ReuseDecisionCode;
  outcome: "pass" | "partial" | "reject";
  summary: string;
  snapshotId?: string;
  details?: Record<string, unknown>;
}

export interface SnapshotLookupResult {
  snapshot?: ReuseSnapshotV1;
  recommendedTier: ReuseTier;
  profile?: {
    kind: "exact" | "relevant-exact" | "compatible" | "different" | "hard-conflict";
    similarity: number;
    coverage: number;
    hardConflict: boolean;
  };
  trace: ReuseDecisionTrace[];
}

export interface ReuseDeltaChange {
  key: string;
  kind: "added" | "changed" | "removed";
  beforeHash?: string;
  afterHash?: string;
  /** Private runtime value. Diagnostics must never render this field. */
  afterValue?: unknown;
}

export interface ReuseDeltaV1 {
  formatVersion: "genui-reuse-delta/1";
  baselineSnapshotId: string;
  queryChanged: boolean;
  genericIntentChanged: boolean;
  layoutChanged: boolean;
  runtimeChanges: Array<keyof RuntimeCompatibilityV1>;
  freshnessRequired: boolean;
  parameterChanges: ReuseDeltaChange[];
  profileChanges: ReuseDeltaChange[];
  affectedSlotNames: string[];
  affectedSteps: PipelineStepName[];
  affectedCardIds: string[];
  reasons: string[];
}

export interface ReuseExecutionPlan {
  tier: ReuseTier;
  snapshotId?: string;
  skillId?: string;
  skillVersionId?: string;
  profileSimilarity: number;
  hardConstraintConflict: boolean;
  reasons: string[];
  delta?: ReuseDeltaV1;
  lookupTrace?: ReuseDecisionTrace[];
  steps: Record<PipelineStepName, {
    strategy: StepExecutionStrategy;
    modelProfile?: ModelProfile;
    fallbackModelProfile?: ModelProfile;
    reason: string;
  }>;
  estimatedSavings?: { durationMs: number; promptTokens: number; completionTokens: number };
}

export interface ProfileDigestCacheRecord {
  contextHash: string;
  digest: import("../lib/profileTypes").ProfileDigest;
  updatedAt: string;
}

export interface SkillAcceleratorRecord {
  id: string;
  skillId?: string;
  skillVersionId?: string;
  sourceRunId: string;
  capsuleArtifactId: string;
  recipeFingerprint: string;
  compatibilityHash: string;
  createdAt: string;
}

export type SkillParameterValueKind = "location" | "date" | "number" | "enum" | "entity" | "text";

export interface QueryAbstractionParameter {
  key: string;
  label?: string;
  valueKind: SkillParameterValueKind;
  value?: string;
  source: "query";
  confidence: number;
}

export interface QueryAbstractionV1 {
  formatVersion: "genui-query-abstraction/1";
  intentKey: string;
  displayName: string;
  invariantSummary: string;
  invariantTerms: string[];
  parameters: QueryAbstractionParameter[];
  constraints: string[];
  confidence: number;
}

export interface SkillIntentTemplate {
  intentKey: string;
  displayName: string;
  invariantSummary: string;
  invariantTerms: string[];
  parameters: Array<{
    key: string;
    label?: string;
    valueKind: SkillParameterValueKind;
    required: boolean;
    bindingSources: Array<"query" | "profile" | "clarification">;
  }>;
}

export interface SkillParameterMapping {
  currentKey: string;
  skillKey: string;
  value?: string;
  confidence: number;
}

export interface SkillMatchComparison {
  skillId: string;
  score: number;
  decision: "compatible" | "partial" | "rejected";
  summary: string;
  matchedInvariants: string[];
  parameterMappings: SkillParameterMapping[];
  conflicts: string[];
  reusableSteps: PipelineStepName[];
  rerunSteps: PipelineStepName[];
  reasonCodes: string[];
}

export interface SkillMatchReport {
  formatVersion: "genui-skill-match-report/1";
  comparisons: SkillMatchComparison[];
  noMatchReason?: string;
}

export interface SkillInvocation {
  formatVersion: "genui-skill-invocation/1";
  skillId: string;
  skillVersionId: string;
  intentKey: string;
  displayText: string;
  bindings: SkillParameterMapping[];
  unmatchedParameters: QueryAbstractionParameter[];
  missingRequiredKeys: string[];
  conflicts: string[];
  reusableSteps: PipelineStepName[];
  rerunSteps: PipelineStepName[];
  deterministicIntentEligible: boolean;
}

export type SkillStepReuseSettings = Record<PipelineStepName, boolean>;

export interface SkillReuseSelection {
  skillId: string;
  skillVersionId: string;
  recipeFingerprint: string;
  score: number;
  margin: number;
  activation: SkillMatchActivation;
  matcherVersion: SkillMatcherVersion;
  matcherModel?: ExternalSkillMatcherModel;
  reasons: string[];
}

export interface TaskRunRecord {
  id: string;
  schemaVersion: 2;
  status: TaskRunStatus;
  queryArtifactId: string;
  contextArtifactId?: string;
  queryFingerprint: string;
  contextFingerprint?: string;
  taskFamily: TaskFamily;
  decisionMode: DecisionMode;
  language: string;
  domains: string[];
  intentTerms: string[];
  slotNames: string[];
  capabilities: string[];
  layoutMode: CardLayoutMode;
  pipelineVersion: string;
  promptSetHash: string;
  openuiSpecHash: string;
  featureFlagsHash: string;
  currentStep?: PipelineStepName;
  sourceSkillId?: string;
  sourceSkillVersionId?: string;
  sourceSkillRecipeFingerprint?: string;
  skillMatchScore?: number;
  skillMatchMargin?: number;
  skillMatchActivation?: SkillMatchActivation;
  skillMatcherVersion?: string;
  skillMatcherModel?: ExternalSkillMatcherModel;
  queryAbstractionArtifactId?: string;
  skillMatchReportArtifactId?: string;
  skillInvocationArtifactId?: string;
  skillStepReuse?: Partial<SkillStepReuseSettings>;
  parentRunId?: string;
  legacySourceEpisodeId?: string;
  skillCandidateStatus: SkillCandidateStatus;
  captureCompleteness: "full" | "legacy-summary";
  acceptedMetrics?: Record<string, number | boolean>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  acceptedAt?: string;
}

export interface ArtifactDependency {
  artifactId: string;
  selectors: string[];
  digest: string;
}

export interface StepRunRecord {
  id: string;
  runId: string;
  sequence: number;
  step: PipelineStepName;
  attempt: number;
  status: "running" | "completed" | "failed";
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  inputFingerprint: string;
  outputFingerprint?: string;
  dependencies: ArtifactDependency[];
  modelProfile?: ModelProfile;
  modelName?: string;
  policyId?: string;
  policyVersion?: number;
  steeringHint?: string;
  promptSpecHash?: string;
  timing?: StepTiming;
  usage?: TokenUsage;
  validationArtifactId?: string;
  errorCode?: string;
  errorSummary?: string;
  skillId?: string;
  skillVersionId?: string;
  skillRecipeFingerprint?: string;
  skillMatcherVersion?: SkillMatcherVersion;
  skillMatcherModel?: ExternalSkillMatcherModel;
  skillExecutionMode?: SkillExecutionMode;
  skillCallsAvoided?: number;
  skillFallbackReason?: string;
  reuseTier?: ReuseTier;
  executionStrategy?: StepExecutionStrategy;
  profileSimilarity?: number;
  startedAt: string;
  completedAt?: string;
}

export type ArtifactKind =
  | "query"
  | "context"
  | "step-input"
  | "step-output"
  | "profile-view"
  | "intent-state"
  | "evidence-state"
  | "clarification-questions"
  | "clarification-answers"
  | "enriched-state"
  | "cardplan-json"
  | "cardplan-markdown"
  | "asset-manifest"
  | "openui-source-initial"
  | "openui-source-final"
  | "openui-diagnostics"
  | "edit-record"
  | "acceptance-feedback"
  | "legacy-episode-summary"
  | "skill-recipe"
  | "skill-execution-capsule"
  | "skill-recipe-patch"
  | "skill-example"
  | "query-abstraction"
  | "skill-match-report"
  | "skill-invocation";

export interface ArtifactRecord {
  id: string;
  runId?: string;
  skillVersionId?: string;
  stepRunId?: string;
  kind: ArtifactKind;
  schemaVersion: number;
  contentHash: string;
  sensitivity: "private" | "sanitized" | "shareable";
  redactionStatus: "not-required" | "pending" | "redacted";
  createdAt: string;
}

export interface ArtifactContentRecord {
  contentHash: string;
  codec: "structured-clone" | "utf8";
  byteSize: number;
  payload: unknown;
}

export interface ArtifactLinkRecord {
  id: string;
  runId?: string;
  fromArtifactId: string;
  toArtifactId: string;
  relation: "consumes" | "produces" | "derived-from" | "supersedes" | "generalized-from";
  step?: PipelineStepName;
  createdAt: string;
}

export interface SkillIndexProfile {
  taskFamilies: TaskFamily[];
  decisionModes: DecisionMode[];
  language: string;
  domains: string[];
  intentTerms: string[];
  slotKeys: string[];
  profileDomains: string[];
  capabilities: string[];
  cardArchetypes: CardPresentationArchetype[];
  layoutModes: CardLayoutMode[];
  actionTypes: IRActionType[];
  requiresFreshData: boolean;
  semanticText: string;
  intentKey?: string;
  intentDisplayName?: string;
  invariantTerms?: string[];
  parameterKeys?: string[];
  parameterKinds?: SkillParameterValueKind[];
  embedding?: number[];
  embeddingModel?: string;
}

export interface SkillRecipeV1 {
  formatVersion: "genui-skill-recipe/1";
  intentContract: {
    taskFamilies: TaskFamily[];
    decisionModes: DecisionMode[];
    queryVariables: string[];
    slotRequirements: Array<{ key: string; required: boolean; description?: string }>;
  };
  profileBindings: Array<{
    key: string;
    domains: string[];
    semanticQuery: string;
    required: boolean;
    maxItems: number;
    runtimeOnly: true;
  }>;
  pipeline: {
    protocol: "six-step-v1";
    steps: Array<{
      step: PipelineStepName;
      hint?: string;
      requiredInputs: string[];
      outputSchemaVersion: number;
    }>;
  };
  clarificationPolicy: Array<{
    slotKeys: string[];
    condition: string;
    questionTemplate: string;
    blocking: boolean;
  }>;
  cardPlanRecipe: {
    topology: "adaptive-unbounded";
    cardRoles: string[];
    actionPolicy: string[];
    assetPolicy: string[];
    layoutPolicy: CardLayoutMode;
  };
  openuiRecipe: {
    preferredPatterns: string[];
    componentPreferences: string[];
    mediaPlacementRules: string[];
    validationProfile: string;
  };
  acceptance: {
    validators: string[];
    qualitySignals: string[];
  };
}

export interface SkillSlotRequirement {
  key: string;
  label?: string;
  description?: string;
  required: boolean;
  blocking: boolean;
  weight?: number;
  options?: string[];
}

export interface SkillRecipeV2 {
  formatVersion: "genui-skill-recipe/2";
  intentContract: {
    taskFamilies: TaskFamily[];
    decisionModes: DecisionMode[];
    taskType: string;
    fulfillment: {
      outcome: "ideas" | "verified_recommendations" | "actionable";
      requiresFreshData: boolean;
      requiresLocation: boolean;
      requiresActionLink: boolean;
    };
    queryVariables: string[];
    slotRequirements: SkillSlotRequirement[];
  };
  profileBindings: Array<{
    key: string;
    slotKeys: string[];
    domains: string[];
    semanticQuery: string;
    required: boolean;
    maxItems: number;
    runtimeOnly: true;
  }>;
  pipeline: {
    protocol: "six-step-v1";
    steps: Array<{
      step: PipelineStepName;
      hint?: string;
      requiredInputs: string[];
      outputSchemaVersion: number;
      reuseStrategy: "guide" | "deterministic-eligible";
    }>;
  };
  clarificationPolicy: Array<{
    slotKeys: string[];
    condition: string;
    questionTemplate: string;
    reason: string;
    options: string[];
    blocking: boolean;
  }>;
  enrichmentPolicy: {
    outcome: "ideas" | "verified_recommendations" | "actionable";
    requiresFreshData: boolean;
    capabilities: string[];
  };
  cardPlanRecipe: {
    topology: "adaptive-unbounded";
    cardPatterns: Array<{
      archetype: CardPresentationArchetype;
      blockKinds: string[];
      actionTypes: IRActionType[];
      assetRoles: string[];
    }>;
    actionPolicy: string[];
    assetPolicy: string[];
    layoutPolicy: CardLayoutMode;
  };
  openuiRecipe: {
    preferredPatterns: string[];
    componentPreferences: string[];
    mediaPlacementRules: string[];
    validationProfile: string;
  };
  acceptance: {
    validators: string[];
    qualitySignals: string[];
  };
}

export interface SkillRecipeV3 extends Omit<SkillRecipeV2, "formatVersion"> {
  formatVersion: "genui-skill-recipe/3";
  intentTemplate: SkillIntentTemplate;
}

export type SkillRecipe = SkillRecipeV3;
export type StoredSkillRecipe = SkillRecipeV1 | SkillRecipeV2 | SkillRecipeV3;

export interface SkillStepContext {
  formatVersion: "genui-skill-step/1";
  step: PipelineStepName;
  mode: "guided" | "deterministic";
  selection: SkillReuseSelection;
  projection: Record<string, unknown>;
  reuseTier?: ReuseTier;
  executionStrategy?: StepExecutionStrategy;
  profileSimilarity?: number;
}

export interface SkillRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: "draft" | "active" | "archived" | "imported-inactive";
  tags: string[];
  activeVersionId: string;
  forkedFromSkillId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersionRecord {
  id: string;
  skillId: string;
  version: number;
  status: "candidate" | "published" | "deprecated";
  storageMode: "snapshot" | "delta";
  baseVersionId?: string;
  recipeArtifactId?: string;
  patchArtifactId?: string;
  capsuleArtifactId?: string;
  exampleIds: string[];
  recipeFingerprint: string;
  bundleHash: string;
  indexProfile: SkillIndexProfile;
  compatibility: string[];
  taskFamilies: TaskFamily[];
  domains: string[];
  createdAt: string;
}

export interface SkillExampleRecord {
  id: string;
  skillVersionId?: string;
  sourceRunId?: string;
  artifactId: string;
  qualityTier: "accepted" | "edited-accepted" | "curated";
  createdAt: string;
}

export interface SkillCandidateRecord {
  id: string;
  runId: string;
  status: "pending-comparison" | "resolved" | "discarded";
  candidateRecipeArtifactId: string;
  capsuleArtifactId?: string;
  candidateExampleId: string;
  indexProfile: SkillIndexProfile;
  taskFamilies: TaskFamily[];
  domains: string[];
  noveltyScore?: number;
  proposedBaseSkillId?: string;
  proposedBaseVersionId?: string;
  resolvedSkillId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface GenUISkillPackage {
  packageVersion: "genui-skill/1" | "genui-skill/2" | "genui-skill/3" | "genui-skill/4";
  exportedAt: string;
  skill: Pick<SkillRecord, "slug" | "name" | "description" | "tags">;
  version: {
    recipe: SkillRecipe;
    capsule?: SkillExecutionCapsuleV1;
    indexProfile: SkillIndexProfile;
    compatibility: string[];
    examples: unknown[];
  };
  checksums: { recipe: string; capsule?: string; examples: string[]; bundle: string };
}
