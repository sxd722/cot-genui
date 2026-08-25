import type { CardPlan } from "../dsl/modules";
import type { ModelProfile } from "../lib/pipelineTypes";
import type { AssetManifest } from "./assetTypes";

export interface OpenUILayoutMeasurement {
  cardId: string;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  bodyClientHeight: number;
  bodyScrollHeight: number;
  headerClientHeight: number;
  headerScrollHeight: number;
  overflowing: boolean;
  componentTypes: string[];
}

export interface OpenUILayoutStabilizationDiagnostics {
  status: "idle" | "measuring" | "repairing" | "stable" | "fallback" | "error";
  planned: { withinBudget: number; total: number };
  static: { withinBudget: number; total: number };
  measured: { withinBudget: number; total: number };
  measurements: OpenUILayoutMeasurement[];
  overflowCardIds: string[];
  repairAttempted: boolean;
  repairSucceeded: boolean;
  fallbackCardIds: string[];
  stable: boolean;
  artifactFingerprint?: string;
  error?: string;
}

export interface OpenUILayoutRepairRequest {
  currentCode: string;
  cardPlan: CardPlan;
  assetManifest?: AssetManifest;
  measurements: OpenUILayoutMeasurement[];
  modelProfile: ModelProfile;
}

export interface OpenUILayoutRepairResponse {
  code: string;
  strategy: "model-repair" | "deterministic-fallback";
  repairedCardIds: string[];
  validation?: unknown;
  model?: string;
  error?: string;
}

export function emptyLayoutStabilization(total = 0): OpenUILayoutStabilizationDiagnostics {
  return {
    status: "idle",
    planned: { withinBudget: 0, total }, static: { withinBudget: 0, total }, measured: { withinBudget: 0, total: 0 },
    measurements: [], overflowCardIds: [], repairAttempted: false, repairSucceeded: false,
    fallbackCardIds: [], stable: false,
  };
}
