import type { CardPlan } from "../dsl/modules";
import type { EffectiveAdaptiveContext, QueryClassification } from "./adaptive/types";
import type { InferenceState, PipelineStepName, PipelineStepOutput } from "./pipelineTypes";
import type { ProfileViewV2, RetrievedEvidence } from "./profileTypes";

export interface StepProvenance {
  step: PipelineStepName;
  classification: QueryClassification;
  policyId?: string;
  policyVersion?: number;
  steeringHint?: string;
  profileView?: ProfileViewV2;
  inputSignals?: string[];
  sourceRefs?: string[];
  outputSignals?: string[];
  cardIds?: string[];
  cardPlanMarkdown?: string;
  codeHash?: string;
  skillId?: string;
  skillVersionId?: string;
  skillRecipeFingerprint?: string;
  skillMatchScore?: number;
  skillExecutionMode?: "normal" | "guided" | "deterministic" | "fallback";
  skillCallsAvoided?: number;
  skillMatcherVersion?: string;
  skillMatcherModel?: string;
}

export function stableTextHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(values: Array<unknown>, limit = 30): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && !!value.trim()).map((value) => value.trim()))].slice(0, limit);
}

export function summarizeStepForProvenance(step: PipelineStepName, args: {
  classification: QueryClassification;
  adaptiveContext?: EffectiveAdaptiveContext;
  profileView?: ProfileViewV2;
  inputState?: InferenceState;
  output: Partial<PipelineStepOutput>;
  retrievedEvidence?: RetrievedEvidence[];
  cardPlan?: CardPlan;
  cardPlanMarkdown?: string;
  openuiCode?: string;
}): StepProvenance {
  const state = args.output.inferenceState ?? args.inputState;
  const base: StepProvenance = {
    step,
    classification: args.classification,
    policyId: args.adaptiveContext?.policyId,
    policyVersion: args.adaptiveContext?.policyVersion,
    steeringHint: args.adaptiveContext?.stepHint,
    skillId: args.output.skillReuse?.skillId,
    skillVersionId: args.output.skillReuse?.skillVersionId,
    skillRecipeFingerprint: args.output.skillReuse?.recipeFingerprint,
    skillMatchScore: args.output.skillReuse?.score,
    skillExecutionMode: args.output.skillReuse?.executionMode,
    skillCallsAvoided: args.output.skillReuse?.callsAvoided,
    skillMatcherVersion: args.output.skillReuse?.matcherVersion,
    skillMatcherModel: args.output.skillReuse?.matcherModel,
  };
  if (step === "intent_analysis") return {
    ...base,
    profileView: args.profileView,
    sourceRefs: compact(args.profileView?.selectedDetails.map((detail) => detail.ref) ?? []),
    outputSignals: compact([
      state?.taskType,
      state?.fulfillment ? `fulfillment:${state.fulfillment.outcome}` : "",
      ...(state?.slotRequirements ?? []).map((item) => `requirement:${item.name}:${item.description}:${item.required}`),
      ...(state?.retrievalRequests ?? []).map((item) => `retrieval:${item.slotNames.join(",")}:${item.domains.join(",")}:${item.semanticQuery}`),
    ], 50),
  };
  if (step === "evidence_resolution") return {
    ...base,
    sourceRefs: compact(args.retrievedEvidence?.map((item) => item.path) ?? []),
    outputSignals: compact([...(state?.slots ?? []).map((slot) => `slot:${slot.name}=${String(slot.value)}:${slot.confidence}`), ...(state?.conflicts ?? []).map((item) => `conflict:${item.slot}`)]),
  };
  if (step === "clarification") return {
    ...base,
    inputSignals: compact((args.inputState?.slots ?? []).filter((slot) => slot.status !== "high").map((slot) => slot.name)),
    outputSignals: compact((state?.questions ?? []).map((question) => {
      const names = Array.isArray(question.slotNames) ? question.slotNames.filter((name): name is string => typeof name === "string") : [];
      return `question:${names.join(",")}:${question.question}`;
    })),
  };
  if (step === "context_enrichment") return { ...base, sourceRefs: compact((state?.slots ?? []).map((slot) => slot.source_record)), outputSignals: compact([state?.summary, ...(state?.assumptions ?? []), ...((state?.webFacts ?? []).flatMap((fact) => fact.entities ?? []).slice(0, 8).map((entity) => `web-entity:${entity.name}`))]) };
  if (step === "card_plan_generate") return { ...base, cardIds: args.cardPlan?.cards.map((card) => card.id), cardPlanMarkdown: args.cardPlanMarkdown, outputSignals: compact(args.cardPlan?.cards.flatMap((card) => [`card:${card.id}:${card.purpose}`, ...(card.actions ?? []).map((action) => `action:${action.type}:${action.label}`)]) ?? [], 50) };
  return { ...base, cardIds: args.cardPlan?.cards.map((card) => card.id), codeHash: stableTextHash(args.openuiCode ?? ""), outputSignals: compact([`statements:${args.output.openuiDiagnostics?.parser.statements ?? 0}`, `valid:${!args.output.openuiDiagnostics?.parser.incomplete}`, `coverage:${args.output.openuiDiagnostics?.coverage.matched ?? 0}/${args.output.openuiDiagnostics?.coverage.required ?? 0}`]) };
}
