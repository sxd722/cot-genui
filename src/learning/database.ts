import Dexie, { type EntityTable } from "dexie";
import type { AdaptivePolicyEntry } from "../lib/adaptive/types";
import type { GenerationEpisode, LearningSettings, PolicyObservation } from "./types";
import { byteSize, sha256 } from "./hash";
import type {
  ArtifactContentRecord,
  ArtifactLinkRecord,
  ArtifactRecord,
  SkillCandidateRecord,
  SkillExampleRecord,
  SkillAcceleratorRecord,
  SkillRecord,
  SkillVersionRecord,
  StepRunRecord,
  TaskRunRecord,
  ReuseSnapshotV1,
  ProfileDigestCacheRecord,
} from "./workflowTypes";

export const LEARNING_DB_NAME = "cot-genui-learning";

export class LearningDatabase extends Dexie {
  episodes!: EntityTable<GenerationEpisode, "id">;
  policies!: EntityTable<AdaptivePolicyEntry, "id">;
  policyObservations!: EntityTable<PolicyObservation, "id">;
  settings!: EntityTable<LearningSettings, "id">;
  taskRuns!: EntityTable<TaskRunRecord, "id">;
  stepRuns!: EntityTable<StepRunRecord, "id">;
  artifacts!: EntityTable<ArtifactRecord, "id">;
  artifactContents!: EntityTable<ArtifactContentRecord, "contentHash">;
  artifactLinks!: EntityTable<ArtifactLinkRecord, "id">;
  skills!: EntityTable<SkillRecord, "id">;
  skillVersions!: EntityTable<SkillVersionRecord, "id">;
  skillExamples!: EntityTable<SkillExampleRecord, "id">;
  skillCandidates!: EntityTable<SkillCandidateRecord, "id">;
  skillAccelerators!: EntityTable<SkillAcceleratorRecord, "id">;
  reuseSnapshots!: EntityTable<ReuseSnapshotV1, "id">;
  profileDigests!: EntityTable<ProfileDigestCacheRecord, "contextHash">;

  constructor(name = LEARNING_DB_NAME) {
    super(name);
    this.version(1).stores({
      episodes: "id",
      policies: "id",
      policyObservations: "id",
      settings: "id",
    });
    this.version(2).stores({
      episodes: "id,status,updatedAt",
      policies: "id,status,scope,taskFamily,updatedAt",
      policyObservations: "id,episodeId,taskFamily,decision,createdAt",
      settings: "id",
      taskRuns: "id,status,createdAt,updatedAt,taskFamily,decisionMode,[taskFamily+status],*domains,*intentTerms,*capabilities,sourceSkillId,skillCandidateStatus",
      stepRuns: "id,runId,[runId+sequence],[runId+step],step,status,inputFingerprint,outputFingerprint,startedAt",
      artifacts: "id,runId,skillVersionId,stepRunId,kind,contentHash,sensitivity,[runId+kind],createdAt",
      artifactContents: "contentHash,byteSize,codec",
      artifactLinks: "id,runId,fromArtifactId,toArtifactId,relation,[runId+step]",
      skills: "id,&slug,status,updatedAt,activeVersionId,forkedFromSkillId,*tags",
      skillVersions: "id,skillId,[skillId+version],baseVersionId,storageMode,bundleHash,*taskFamilies,*domains",
      skillExamples: "id,skillVersionId,sourceRunId,qualityTier",
      skillCandidates: "id,runId,status,createdAt,*taskFamilies,*domains",
    }).upgrade(async (transaction) => {
      const episodes = await transaction.table<GenerationEpisode>("episodes").toArray();
      for (const episode of episodes) {
        const timestamp = episode.updatedAt || episode.startedAt;
        const runId = `legacy_run_${episode.id}`;
        const queryArtifactId = `legacy_query_${episode.id}`;
        const summaryArtifactId = `legacy_summary_${episode.id}`;
        const queryHash = await Dexie.waitFor(sha256(episode.query));
        const summaryHash = await Dexie.waitFor(sha256(episode));
        await transaction.table("artifactContents").bulkPut([
          { contentHash: queryHash, codec: "utf8", byteSize: byteSize(episode.query), payload: episode.query },
          { contentHash: summaryHash, codec: "structured-clone", byteSize: byteSize(episode), payload: episode },
        ]);
        await transaction.table("artifacts").bulkPut([
        { id: queryArtifactId, runId, kind: "query", schemaVersion: 1, contentHash: queryHash, sensitivity: "private", redactionStatus: "not-required", createdAt: episode.startedAt },
        { id: summaryArtifactId, runId, kind: "legacy-episode-summary", schemaVersion: 1, contentHash: summaryHash, sensitivity: "private", redactionStatus: "not-required", createdAt: timestamp },
        ]);
        await transaction.table("taskRuns").put({
          id: runId,
          schemaVersion: 2,
          status: episode.status === "accepted" ? "accepted" : episode.status === "abandoned" ? "abandoned" : "completed",
          queryArtifactId,
          queryFingerprint: queryHash,
          taskFamily: episode.queryClassification.taskFamily,
          decisionMode: episode.queryClassification.decisionMode,
          language: "zh-CN",
          domains: episode.profileViewSummary?.selectedDomains ?? [],
          intentTerms: [], slotNames: [], capabilities: [], layoutMode: "free",
          pipelineVersion: "legacy-six-step-v1", promptSetHash: "legacy", openuiSpecHash: "legacy", featureFlagsHash: "legacy",
          legacySourceEpisodeId: episode.id,
          skillCandidateStatus: episode.status === "accepted" ? "ineligible" : "discarded",
          captureCompleteness: "legacy-summary",
          acceptedMetrics: episode.rewardMetrics,
          createdAt: episode.startedAt, updatedAt: timestamp, acceptedAt: episode.acceptedAt,
        } satisfies TaskRunRecord);
      }
    });
    this.version(3).stores({
      episodes: "id,status,updatedAt",
      policies: "id,status,scope,taskFamily,updatedAt",
      policyObservations: "id,episodeId,taskFamily,decision,createdAt",
      settings: "id",
      taskRuns: "id,status,createdAt,updatedAt,taskFamily,decisionMode,[taskFamily+status],*domains,*intentTerms,*capabilities,sourceSkillId,skillCandidateStatus",
      stepRuns: "id,runId,[runId+sequence],[runId+step],step,status,inputFingerprint,outputFingerprint,startedAt",
      artifacts: "id,runId,skillVersionId,stepRunId,kind,contentHash,sensitivity,[runId+kind],createdAt",
      artifactContents: "contentHash,byteSize,codec",
      artifactLinks: "id,runId,fromArtifactId,toArtifactId,relation,[runId+step]",
      skills: "id,&slug,status,updatedAt,activeVersionId,forkedFromSkillId,*tags",
      skillVersions: "id,skillId,[skillId+version],baseVersionId,storageMode,bundleHash,*taskFamilies,*domains",
      skillExamples: "id,skillVersionId,sourceRunId,qualityTier",
      skillCandidates: "id,runId,status,createdAt,*taskFamilies,*domains",
      skillAccelerators: "id,skillId,skillVersionId,sourceRunId,recipeFingerprint,compatibilityHash,createdAt,[skillVersionId+compatibilityHash]",
      reuseSnapshots: "id,sourceRunId,skillId,skillVersionId,queryFingerprint,contextFingerprint,relevantProfileFingerprint,invocationFingerprint,layoutMode,compatibilityHash,expiresAt,createdAt,[queryFingerprint+contextFingerprint+layoutMode],[invocationFingerprint+relevantProfileFingerprint+layoutMode]",
      profileDigests: "contextHash,updatedAt",
    });
    this.version(4).stores({
      episodes: "id,status,updatedAt",
      policies: "id,status,scope,taskFamily,updatedAt",
      policyObservations: "id,episodeId,taskFamily,decision,createdAt",
      settings: "id",
      taskRuns: "id,status,createdAt,updatedAt,taskFamily,decisionMode,[taskFamily+status],*domains,*intentTerms,*capabilities,sourceSkillId,skillCandidateStatus",
      stepRuns: "id,runId,[runId+sequence],[runId+step],step,status,inputFingerprint,outputFingerprint,startedAt",
      artifacts: "id,runId,skillVersionId,stepRunId,kind,contentHash,sensitivity,[runId+kind],createdAt",
      artifactContents: "contentHash,byteSize,codec",
      artifactLinks: "id,runId,fromArtifactId,toArtifactId,relation,[runId+step]",
      skills: "id,&slug,status,updatedAt,activeVersionId,forkedFromSkillId,*tags",
      skillVersions: "id,skillId,[skillId+version],baseVersionId,storageMode,bundleHash,*taskFamilies,*domains",
      skillExamples: "id,skillVersionId,sourceRunId,qualityTier",
      skillCandidates: "id,runId,status,createdAt,*taskFamilies,*domains",
      skillAccelerators: "id,skillId,skillVersionId,sourceRunId,recipeFingerprint,compatibilityHash,createdAt,[skillVersionId+compatibilityHash]",
      reuseSnapshots: "id,sourceRunId,skillId,skillVersionId,queryFingerprint,contextFingerprint,relevantProfileFingerprint,invocationFingerprint,genericInvocationFingerprint,layoutMode,compatibilityHash,expiresAt,createdAt,[queryFingerprint+contextFingerprint+layoutMode],[invocationFingerprint+relevantProfileFingerprint+layoutMode],[genericInvocationFingerprint+layoutMode]",
      profileDigests: "contextHash,updatedAt",
    });
  }
}

let database: LearningDatabase | undefined;

export function getLearningDatabase(): LearningDatabase {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB 仅在浏览器中可用");
  database ??= new LearningDatabase();
  return database;
}

export function resetLearningDatabaseSingleton() {
  database?.close();
  database = undefined;
}
