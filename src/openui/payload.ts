import type { CardPlan } from "../dsl/modules";
import type { OpenUIValidationResult } from "../lib/openui";
import { buildOpenUIBootstrap } from "./bootstrap";
import { buildOpenUIDesignBrief, type OpenUIDesignBrief } from "./designBrief";
import type { AssetManifest } from "./assetTypes";

export interface OpenUIGenerationPayload {
  requiredShell: string;
  designBrief: OpenUIDesignBrief;
}

export interface OpenUIRepairPayload {
  requiredShell: string;
  previousOpenUI: string;
  validationErrors: string[];
  missingCoverage: string[];
}

/** The only business content sent to the first-pass OpenUI generation model. */
export function buildOpenUIGenerationPayload(cardPlan: CardPlan, assetManifest?: AssetManifest): OpenUIGenerationPayload {
  return {
    requiredShell: buildOpenUIBootstrap(cardPlan).code,
    designBrief: buildOpenUIDesignBrief(cardPlan, assetManifest),
  };
}

/** Repair receives only structural constraints and diagnostics, never the brief again. */
export function buildOpenUIRepairPayload(
  cardPlan: CardPlan,
  previousOpenUI: string,
  validation: OpenUIValidationResult,
): OpenUIRepairPayload {
  return {
    requiredShell: buildOpenUIBootstrap(cardPlan).code,
    previousOpenUI,
    validationErrors: validation.errors,
    missingCoverage: validation.coverage.missing,
  };
}
