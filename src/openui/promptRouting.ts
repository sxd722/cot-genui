import { generateSystemPrompt, type LibrarySpec } from "@openuidev/lang-core";
import type { TaskFamily } from "@/lib/adaptive/types";
import type { ModelProfile } from "@/lib/pipelineTypes";
import { openUIPromptTierFor } from "./modelCapabilities";
import { paletteNameForTaskFamily } from "./palettes";
import { createCotGenUIPromptOptions, examplesForTaskFamily } from "./promptOptions";
import compactGeneralSpecJson from "./generated/compact-general.spec.json";
import compactPlanningSpecJson from "./generated/compact-planning.spec.json";
import compactRecommendationSpecJson from "./generated/compact-recommendation.spec.json";
import compactAnalysisSpecJson from "./generated/compact-analysis.spec.json";
import expandedSpecJson from "./generated/expanded.spec.json";

/**
 * Model/task prompt routing. Pure function over generated specs and palettes,
 * kept free of "server-only" so tests and client code can call it directly.
 */

const promptSpecs = {
  general: compactGeneralSpecJson as LibrarySpec,
  planning: compactPlanningSpecJson as LibrarySpec,
  recommendation: compactRecommendationSpecJson as LibrarySpec,
  analysis: compactAnalysisSpecJson as LibrarySpec,
  expanded: expandedSpecJson as LibrarySpec,
};

export function openUISystemPromptFor(args: { taskFamily: TaskFamily; modelProfile: ModelProfile; localBindings?: boolean }): { prompt: string; promptProfile: string } {
  const tier = openUIPromptTierFor(args.modelProfile);
  const familyPalette = paletteNameForTaskFamily(args.taskFamily);
  const palette = tier === "expanded" ? "expanded" : familyPalette;
  const familyExamples = examplesForTaskFamily(args.taskFamily);
  const examples = tier === "expanded" && familyPalette !== "general"
    ? [...familyExamples, examplesForTaskFamily("general")[0]]
    : familyExamples;
  const promptOptions = createCotGenUIPromptOptions({ localBindings: args.localBindings ?? false, examples });
  return {
    prompt: generateSystemPrompt({ library: promptSpecs[palette], promptOptions }),
    promptProfile: `${tier}:${tier === "expanded" ? "general" : palette}`,
  };
}
