import type { CardPlan } from "../dsl/modules";
import type { OpenUIValidationResult } from "../lib/openui";
import { buildOpenUIBootstrap } from "./bootstrap";
import { cardPlanToVibeMarkdown } from "./vibeMarkdown";

export interface OpenUIGenerationPayload {
  cardPlanMarkdown: string;
  requiredShell: string;
}

export interface OpenUIRepairPayload {
  requiredShell: string;
  previousOpenUI: string;
  validationErrors: string[];
  missingCoverage: string[];
}

/** The only business content sent to the first-pass OpenUI generation model. */
export function buildOpenUIGenerationPayload(cardPlan: CardPlan): OpenUIGenerationPayload {
  return {
    cardPlanMarkdown: cardPlanToVibeMarkdown(cardPlan),
    requiredShell: buildOpenUIBootstrap(cardPlan).code,
  };
}

/** Repair receives only structural constraints and diagnostics, never the Markdown brief again. */
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
