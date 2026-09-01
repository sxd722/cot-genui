import type { RuntimeCompatibilityV1 } from "./workflowTypes";
import { FEATURE_FLAGS } from "../lib/featureFlags";
import openUISpec from "../openui/generated/system-prompt.spec.json";
import { canonicalJson } from "./hash";

export const PIPELINE_VERSION = "six-step-v1";
const PROMPT_REVISION = "2026-08-28-skill-reuse-typed-delta-v2";

function shortStableHash(value: unknown): string {
  const text = typeof value === "string" ? value : canonicalJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export const PROMPT_SET_HASH = shortStableHash(PROMPT_REVISION);
export const OPENUI_SPEC_HASH = shortStableHash(openUISpec);
export const FEATURE_FLAGS_HASH = shortStableHash(FEATURE_FLAGS);

export function currentRuntimeCompatibility(): RuntimeCompatibilityV1 {
  return {
    pipelineVersion: PIPELINE_VERSION,
    promptSetHash: PROMPT_SET_HASH,
    openuiSpecHash: OPENUI_SPEC_HASH,
    featureFlagsHash: FEATURE_FLAGS_HASH,
  };
}
