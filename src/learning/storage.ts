import type { AdaptivePolicyEntry } from "../lib/adaptive/types";
import { getLearningDatabase } from "./database";
import type { GenerationEpisode, LearningExport, LearningSettings, PolicyObservation } from "./types";
import { PIPELINE_STEPS } from "../lib/pipelineTypes";
import type { ProfileDigestCacheRecord, SkillStepReuseSettings } from "./workflowTypes";
import type { ActiveStitchJobRecord } from "../stitch/types";

export function defaultSkillStepReuse(): SkillStepReuseSettings {
  return Object.fromEntries(PIPELINE_STEPS.map((step) => [step, true])) as SkillStepReuseSettings;
}

export const putEpisode = (episode: GenerationEpisode) => getLearningDatabase().episodes.put(episode).then(() => undefined);
export const putPolicy = (policy: AdaptivePolicyEntry) => getLearningDatabase().policies.put(policy).then(() => undefined);
export const putPolicyObservation = (observation: PolicyObservation) => getLearningDatabase().policyObservations.put(observation).then(() => undefined);
export const putLearningSettings = (settings: LearningSettings) => getLearningDatabase().settings.put(settings).then(() => undefined);
export const listEpisodes = () => getLearningDatabase().episodes.toArray();
export const listPolicies = () => getLearningDatabase().policies.toArray();
export const listPolicyObservations = () => getLearningDatabase().policyObservations.toArray();

export async function getLearningSettings(): Promise<LearningSettings> {
  const stored = await getLearningDatabase().settings.get("settings");
  return {
    id: "settings",
    enabled: stored?.enabled ?? true,
    learningMode: stored?.learningMode ?? "manual",
    skillReuseEnabled: stored?.skillReuseEnabled ?? true,
    skillStepReuse: { ...defaultSkillStepReuse(), ...(stored?.skillStepReuse ?? {}) },
    skillMatchModel: stored?.skillMatchModel ?? "groq_qwen_3_6_27b",
    skillExecutionModel: stored?.skillExecutionModel ?? "groq_qwen_3_6_27b",
    updatedAt: stored?.updatedAt ?? new Date().toISOString(),
  };
}

export const listSkills = () => getLearningDatabase().skills.toArray();
export const listSkillVersions = () => getLearningDatabase().skillVersions.toArray();
export const listSkillCandidates = () => getLearningDatabase().skillCandidates.toArray();
export const putProfileDigestCache = (record: ProfileDigestCacheRecord) => getLearningDatabase().profileDigests.put(record).then(() => undefined);
export const getProfileDigestCache = (contextHash: string) => getLearningDatabase().profileDigests.get(contextHash);
export const putActiveStitchJob = (record: ActiveStitchJobRecord) => getLearningDatabase().stitchJobs.put(record).then(() => undefined);
export const getLatestActiveStitchJob = () => getLearningDatabase().stitchJobs.orderBy("updatedAt").last();
export const deleteActiveStitchJob = (jobId: string) => getLearningDatabase().stitchJobs.delete(jobId).then(() => undefined);

export async function exportLearningData(): Promise<LearningExport> {
  const database = getLearningDatabase();
  const [episodes, policies, observations, settings, taskRuns, stepRuns, artifacts, skills, skillVersions, skillCandidates] = await Promise.all([
    listEpisodes(), listPolicies(), listPolicyObservations(), getLearningSettings(),
    database.taskRuns.toArray(), database.stepRuns.toArray(), database.artifacts.toArray(),
    database.skills.toArray(), database.skillVersions.toArray(), database.skillCandidates.toArray(),
  ]);
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(), episodes, policies, observations, settings,
    workflow: { taskRuns, stepRuns, artifacts, skills, skillVersions, skillCandidates },
  };
}
