import type { PromptOptions } from "@openuidev/lang-core";
import type { TaskFamily } from "@/lib/adaptive/types";
import { GENERAL_OPENUI_EXAMPLES } from "./examples/general";
import { PLANNING_OPENUI_EXAMPLES } from "./examples/planning";
import { RECOMMENDATION_OPENUI_EXAMPLES } from "./examples/recommendation";
import { ANALYSIS_OPENUI_EXAMPLES } from "./examples/analysis";

export const ALL_OPENUI_EXAMPLES = [
  ...GENERAL_OPENUI_EXAMPLES,
  ...PLANNING_OPENUI_EXAMPLES,
  ...RECOMMENDATION_OPENUI_EXAMPLES,
  ...ANALYSIS_OPENUI_EXAMPLES,
];

export function examplesForTaskFamily(family: TaskFamily): string[] {
  if (family === "planning") return [...PLANNING_OPENUI_EXAMPLES];
  if (family === "recommendation" || family === "decision") return [...RECOMMENDATION_OPENUI_EXAMPLES];
  if (family === "analysis" || family === "information") return [...ANALYSIS_OPENUI_EXAMPLES];
  return [...GENERAL_OPENUI_EXAMPLES];
}

const BASE_RULES = [
    "Treat cardPlanMarkdown as a creative brief, not as a wireframe. Preserve its facts, intent, card order, and action meaning, while freely choosing hierarchy, density, components, and visual rhythm.",
    "The supplied CardPlan may contain one card or several cards. Never infer a preferred card count from the example; requiredShell is the sole source of truth for the chosen count.",
    "CardDeck is the only root and GeneratedCard is the only peer card boundary.",
    "Copy every line from requiredShell exactly as the first statements of the complete program, then define every referenced body statement.",
    "Do not add, remove, merge, reorder, or nest GeneratedCard components.",
    "Inside each GeneratedCard, compose freely with the available content, layout, chart, table, tabs, accordion, callout, and data-display components. Do not use Card as another card boundary.",
    "When one semantic component directly represents the content, prefer it over manually rebuilding the same pattern with many Stack/Card/TextContent statements. Semantic components are not mandatory; use generic OpenUI components when they express the result more naturally.",
    "Choose components by semantic fit, not novelty.",
    "Avoid rebuilding a semantic pattern from many primitive Stack/TextContent/Card nodes when a provided semantic component directly represents it.",
    "Do not force charts, tabs, images, forms or carousels when the data does not justify them.",
    "For multi-card results, vary composition when card purposes differ; repeated card purpose may legitimately share a composition.",
    "Use visual hierarchy to distinguish primary conclusion, evidence, comparison and next action.",
    "The Card component is allowed inside GeneratedCard as a local visual surface, inset panel or grouped region; it must never become another peer card boundary.",
    "Use AssetImage or AssetGallery only with assetRef IDs explicitly listed under 可用媒体. Never invent an asset ID and never place an image URL in OpenUI source.",
    "Use each supplied actionRef exactly once through Button + @ToAssistant or an approved HostAction component. Never show an actionRef as visible text.",
    "Never use Query, Mutation, @Run, @OpenUrl, or invented URLs. The host owns all side effects.",
    "Return only a complete OpenUI Lang program. Do not return Markdown fences, JSON, HTML, comments, or prose.",
];

export function createCotGenUIPromptOptions(args: { localBindings: boolean; examples: string[] }): PromptOptions {
  return {
    toolCalls: false,
    bindings: args.localBindings,
    editMode: false,
    inlineMode: false,
    preamble: "You are a generative visual designer. Turn CardPlan Markdown into a polished OpenUI card experience.",
    additionalRules: [
      ...BASE_RULES,
      ...(args.localBindings ? [
        "Local bindings are only for transient in-card UI state such as selected option, expanded content, filters, sliders or visibility.",
        "Never use local state to represent a completed purchase, save, navigation, upload, network request or other host side effect. Host side effects must continue to use supplied actionRef values.",
      ] : []),
    ],
    examples: args.examples,
  };
}

export const cotGenUIPromptOptions = createCotGenUIPromptOptions({ localBindings: false, examples: ALL_OPENUI_EXAMPLES });

export const promptOptions = cotGenUIPromptOptions;
