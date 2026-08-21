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
    "designBrief.renderableContent is the only textual source that may be copied or paraphrased into visible UI.",
    "designBrief.designIntent is NON-RENDERABLE metadata. Use it only to choose component composition, hierarchy, density, emphasis, and card treatment.",
    "Never render field names, Card IDs, schema labels, archetype/density/emphasis values, internal guidance, or authoring instructions as user-facing text.",
    "availableAssets are host-validated capabilities, not visible copy. Use only listed assetRef IDs; requestId groups assets from one CardPlan image requirement, while role and aspect guide placement.",
    "actions are capabilities. Render their labels through valid actions, never display actionRef as text.",
    "The supplied brief may contain one card or several cards. Never infer a preferred card count from the example; requiredShell is the sole source of truth for the chosen count.",
    "CardDeck is the only root and GeneratedCard is the only peer card boundary.",
    "Copy every line from requiredShell exactly as the first statements of the complete program, then define every referenced body statement.",
    "Do not add, remove, merge, reorder, or nest GeneratedCard components.",
    "Inside each GeneratedCard, compose freely with the available content, layout, chart, table, tabs, accordion, callout, and data-display components. Do not use Card as another card boundary.",
    "When one semantic component directly represents the content, prefer it over manually rebuilding the same pattern with many Stack/Card/TextContent statements. Semantic components are not mandatory; use generic OpenUI components when they express the result more naturally.",
    "Choose components by semantic fit, not novelty.",
    "Avoid rebuilding a semantic pattern from many primitive Stack/TextContent/Card nodes when a provided semantic component directly represents it.",
    "Do not force charts, tabs, forms or carousels when the data does not justify them.",
    "Every distinct requestId with non-empty availableAssets is a required CardPlan image requirement. Use enough listed assetRef IDs from that request in its owning card: one for image requests; for gallery requests use two when at least two are available, otherwise use the single available image.",
    "Placement guidance: role=hero fits MediaHero or AssetImage with the supplied aspect; role=supporting fits AssetImage or the matching RecommendationGrid item; role=gallery fits AssetGallery when multiple assets are available.",
    "Do not repeat an assetRef and do not move an assetRef to another card. The host has already validated semantic availability; omission of an accepted request is invalid and will trigger one repair.",
    "For multi-card results, vary composition when card purposes differ; repeated card purpose may legitimately share a composition.",
    "Use visual hierarchy to distinguish primary conclusion, evidence, comparison and next action.",
    "The Card component is allowed inside GeneratedCard as a local visual surface, inset panel or grouped region; it must never become another peer card boundary.",
    "Use MediaHero, RecommendationGrid, AssetImage or AssetGallery only with assetRef IDs explicitly listed in that card's designBrief.availableAssets. Never invent an asset ID and never place an image URL in OpenUI source.",
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
    preamble: "You are a generative visual designer. Turn the supplied design brief (renderableContent + designIntent) into a polished OpenUI card experience. renderableContent is the only text that may become visible UI; designIntent is NON-RENDERABLE metadata for composition decisions only.",
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
