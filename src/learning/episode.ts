import type { QueryClassification } from "@/lib/adaptive/types";
import type { ModelProfile, PipelineStepName, PipelineStepOutput, TokenUsage } from "@/lib/pipelineTypes";
import type { StepProvenance } from "@/lib/provenance";
import type { OpenUIEditVersion } from "@/lib/cardEditingTypes";
import type { GenerationEpisode } from "./types";

function now() { return new Date().toISOString(); }

function uniqueId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createGenerationEpisode(input: {
  query: string;
  classification: QueryClassification;
  userKey?: string;
}): GenerationEpisode {
  const timestamp = now();
  return {
    id: uniqueId("episode"),
    schemaVersion: 1,
    query: input.query.slice(0, 10_000),
    queryClassification: input.classification,
    userKey: input.userKey,
    status: "generating",
    startedAt: timestamp,
    updatedAt: timestamp,
    steps: {},
    edits: [],
  };
}

export function recordEpisodeStep(
  episode: GenerationEpisode,
  step: PipelineStepName,
  input: {
    modelProfile?: ModelProfile;
    adaptive?: PipelineStepOutput["adaptive"];
    provenance?: StepProvenance;
    usage?: TokenUsage;
  },
): GenerationEpisode {
  const timestamp = now();
  const profileView = input.provenance?.profileView;
  return {
    ...episode,
    updatedAt: timestamp,
    profileViewSummary: profileView ? {
      charCount: profileView.budget.profileViewChars,
      selectedDomains: [...new Set(profileView.selectedDetails.map((detail) => detail.domain))],
      selectedDetailCount: profileView.selectedDetails.length,
    } : episode.profileViewSummary,
    steps: {
      ...episode.steps,
      [step]: {
        step,
        modelProfile: input.modelProfile,
        policyId: input.adaptive?.policyId,
        policyVersion: input.adaptive?.policyVersion,
        steeringHint: input.adaptive?.steeringHint,
        provenance: input.provenance,
        usage: input.usage,
        recordedAt: timestamp,
      },
    },
  };
}

export function recordInitialOpenUI(episode: GenerationEpisode, code: string, cardCount: number): GenerationEpisode {
  if (episode.initialOpenUI) return episode;
  const timestamp = now();
  return {
    ...episode,
    status: "editing",
    updatedAt: timestamp,
    initialOpenUI: { code, cardCount, recordedAt: timestamp },
  };
}

export function appendEpisodeEdit(episode: GenerationEpisode, version: OpenUIEditVersion): GenerationEpisode {
  if (!version.target || !version.instruction || !version.modelProfile || version.beforeSlice === undefined || version.afterSlice === undefined) return episode;
  const timestamp = now();
  return {
    ...episode,
    status: "editing",
    updatedAt: timestamp,
    edits: [...episode.edits, {
      versionId: version.id,
      cardId: version.target.cardId,
      instruction: version.instruction,
      target: version.target,
      beforeSlice: version.beforeSlice,
      afterSlice: version.afterSlice,
      modelProfile: version.modelProfile,
      createdAt: version.createdAt,
      metrics: version.metrics,
    }],
  };
}

export function recordEpisodeUndo(episode: GenerationEpisode): GenerationEpisode {
  return {
    ...episode,
    updatedAt: now(),
    rewardMetrics: {
      editCount: episode.rewardMetrics?.editCount ?? episode.edits.length,
      semanticEditCount: episode.rewardMetrics?.semanticEditCount ?? 0,
      visualEditCount: episode.rewardMetrics?.visualEditCount ?? 0,
      undoCount: (episode.rewardMetrics?.undoCount ?? 0) + 1,
      acceptedWithoutEdit: false,
      timeToAcceptMs: episode.rewardMetrics?.timeToAcceptMs ?? 0,
    },
  };
}

export function finalizeEpisode(episode: GenerationEpisode, finalOpenUI: string): GenerationEpisode {
  const timestamp = now();
  const visualEditCount = episode.edits.filter((edit) => /颜色|字号|醒目|badge|阴影|圆角|图片|高亮|布局|间距|对齐|横向|点击|滑动|展开|hover|切换/i.test(edit.instruction)).length;
  return {
    ...episode,
    status: "accepted",
    updatedAt: timestamp,
    acceptedAt: timestamp,
    finalOpenUI,
    rewardMetrics: {
      editCount: episode.edits.length,
      semanticEditCount: episode.edits.length - visualEditCount,
      visualEditCount,
      undoCount: episode.rewardMetrics?.undoCount ?? 0,
      acceptedWithoutEdit: episode.edits.length === 0,
      timeToAcceptMs: Math.max(0, Date.parse(timestamp) - Date.parse(episode.startedAt)),
    },
  };
}

export function abandonEpisode(episode: GenerationEpisode): GenerationEpisode {
  if (episode.status === "accepted" || episode.status === "abandoned") return episode;
  const timestamp = now();
  return { ...episode, status: "abandoned", updatedAt: timestamp, abandonedAt: timestamp };
}
