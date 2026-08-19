import type { PipelineStepName } from "../pipelineTypes";

export const TASK_FAMILIES = [
  "recommendation",
  "planning",
  "decision",
  "information",
  "creation",
  "action",
  "analysis",
  "support",
  "general",
] as const;

export type TaskFamily = (typeof TASK_FAMILIES)[number];

export const DECISION_MODES = [
  "explore",
  "narrow_down",
  "compare",
  "optimize",
  "verify",
  "execute",
  "reassure",
  "general",
] as const;

export type DecisionMode = (typeof DECISION_MODES)[number];

export interface QueryClassification {
  taskFamily: TaskFamily;
  decisionMode: DecisionMode;
  confidence: number;
  source: "heuristic" | "step1-refined";
}

export type StepHintMap = Record<PipelineStepName, string>;

export interface AdaptivePolicyEntry {
  id: string;
  scope: "global" | "class" | "user-class";
  taskFamily?: TaskFamily;
  userKey?: string;
  profileOverlay: string;
  stepHints: StepHintMap;
  version: number;
  status: "stable" | "candidate";
  supportCount: number;
  updatedAt: string;
}

export interface EffectiveAdaptiveContext {
  classification: QueryClassification;
  policyId: string;
  policyVersion: number;
  profileOverlay: string;
  stepHint: string;
}
