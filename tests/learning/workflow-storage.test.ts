import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CardPlan } from "../../src/dsl/modules";
import type { QueryClassification } from "../../src/lib/adaptive/types";
import type { GenerationEpisode } from "../../src/learning/types";
import { LearningDatabase, LEARNING_DB_NAME, getLearningDatabase, resetLearningDatabaseSingleton } from "../../src/learning/database";
import { beginStepCapture, completeStepCapture, acceptTaskRunAndCreateCandidate, startTaskRun } from "../../src/learning/workflowCapture";
import { exportSkillPackage, importSkillPackage, materializeSkillRecipe, resolveSkillCandidate } from "../../src/learning/skillPackage";

const classification = { taskFamily: "planning", decisionMode: "compare", confidence: 0.9, source: "heuristic" } satisfies QueryClassification;

function plan(cardCount = 2): CardPlan {
  return {
    skillName: "旅行方案",
    reasoning: "fixture",
    layoutPolicy: { mode: "free" },
    cards: Array.from({ length: cardCount }, (_, index) => ({
      id: `card_${index + 1}`,
      title: `卡片${index + 1}`,
      purpose: `展示第${index + 1}组信息`,
      presentation: { archetype: index === 0 ? "hero" : "standard", density: "balanced" },
      blocks: [{ kind: "summary", text: `内容${index + 1}` }],
      actions: index === 0 ? [{ id: "view", label: "查看", type: "navigate", targetCardId: "card_2" }] : [],
    })),
  };
}

function episode(id: string): GenerationEpisode {
  const timestamp = new Date().toISOString();
  return {
    id, schemaVersion: 1, query: "私人旅行问题", queryClassification: classification,
    status: "accepted", startedAt: timestamp, updatedAt: timestamp, acceptedAt: timestamp,
    steps: {}, edits: [], finalOpenUI: "root = CardDeck([])",
    rewardMetrics: { editCount: 0, semanticEditCount: 0, visualEditCount: 0, undoCount: 0, acceptedWithoutEdit: true, timeToAcceptMs: 10 },
  };
}

beforeEach(async () => {
  resetLearningDatabaseSingleton();
  await Dexie.delete(LEARNING_DB_NAME);
});

afterEach(async () => {
  resetLearningDatabaseSingleton();
  await Dexie.delete(LEARNING_DB_NAME);
});

describe("workflow storage", () => {
  it("captures step checkpoints atomically and deduplicates identical artifact contents", async () => {
    const run = await startTaskRun({ episodeId: "episode_1", query: "北京亲子酒店", classification, layoutMode: "free" });
    const first = await beginStepCapture({ runId: run.id, step: "intent_analysis", request: { query: "北京亲子酒店", deviceContext: { secret: true } } });
    const output = { inferenceState: { taskType: "travel", needsContext: false, slotRequirements: [], slots: [], conflicts: [], questions: [], assumptions: [] } };
    await completeStepCapture({ runId: run.id, stepRunId: first.id, step: "intent_analysis", output });
    const second = await beginStepCapture({ runId: run.id, step: "intent_analysis", request: { query: "北京亲子酒店", deviceContext: { secret: false } } });
    await completeStepCapture({ runId: run.id, stepRunId: second.id, step: "intent_analysis", output });

    const database = getLearningDatabase();
    const outputs = await database.artifacts.where("kind").equals("step-output").toArray();
    expect(outputs).toHaveLength(2);
    expect(outputs[0].contentHash).toBe(outputs[1].contentHash);
    expect(await database.artifactContents.get(outputs[0].contentHash)).toBeTruthy();
    const inputPayload = await database.artifactContents.get((await database.artifacts.get(first.inputArtifactIds[0]))!.contentHash);
    expect(JSON.stringify(inputPayload?.payload)).not.toContain("deviceContext");
  });

  it("stores abstraction, match report, and concrete invocation as private TaskRun artifacts", async () => {
    const abstraction = {
      formatVersion: "genui-query-abstraction/1" as const,
      intentKey: "travel_planning", displayName: "旅游", invariantSummary: "规划一次旅行",
      invariantTerms: ["旅行"],
      parameters: [{ key: "destination", valueKind: "location" as const, value: "北京", source: "query" as const, confidence: 0.99 }],
      constraints: [], confidence: 0.98,
    };
    const report = {
      formatVersion: "genui-skill-match-report/1" as const,
      comparisons: [{
        skillId: "skill_travel", score: 0.9, decision: "compatible" as const, summary: "通用旅行模板匹配",
        matchedInvariants: ["旅行"], parameterMappings: [{ currentKey: "destination", skillKey: "destination", confidence: 0.99 }],
        conflicts: [], reusableSteps: ["intent_analysis" as const], rerunSteps: ["evidence_resolution" as const], reasonCodes: ["intent_template_match"],
      }],
    };
    const invocation = {
      formatVersion: "genui-skill-invocation/1" as const,
      skillId: "skill_travel", skillVersionId: "skillv_travel", intentKey: "travel_planning",
      displayText: "旅游(destination=北京)",
      bindings: [{ currentKey: "destination", skillKey: "destination", value: "北京", confidence: 0.99 }],
      unmatchedParameters: [], missingRequiredKeys: [], conflicts: [], reusableSteps: ["intent_analysis" as const],
      rerunSteps: ["evidence_resolution" as const], deterministicIntentEligible: true,
    };
    const run = await startTaskRun({
      episodeId: "episode_private_match", query: "去北京旅游", classification, layoutMode: "free",
      queryAbstraction: abstraction, skillMatchReport: report, skillInvocation: invocation,
    });
    expect(run.queryAbstractionArtifactId).toBeTruthy();
    expect(run.skillMatchReportArtifactId).toBeTruthy();
    expect(run.skillInvocationArtifactId).toBeTruthy();
    const artifacts = await getLearningDatabase().artifacts.where("runId").equals(run.id).toArray();
    expect(artifacts.filter((artifact) => ["query-abstraction", "skill-match-report", "skill-invocation"].includes(artifact.kind)))
      .toHaveLength(3);
    expect(artifacts.filter((artifact) => artifact.kind !== "query").every((artifact) => artifact.sensitivity === "private")).toBe(true);
  });

  it("keeps upstream indexing fields when CardPlan/OpenUI steps have no inferenceState", async () => {
    const run = await startTaskRun({ episodeId: "episode_index", query: "北京亲子酒店", classification, layoutMode: "free" });
    const intent = await beginStepCapture({ runId: run.id, step: "intent_analysis", request: { query: "北京亲子酒店" } });
    await completeStepCapture({
      runId: run.id, stepRunId: intent.id, step: "intent_analysis",
      output: {
        inferenceState: {
          taskType: "旅行规划", needsContext: true, requestedDomains: ["travel"],
          slotRequirements: [{ name: "destination", description: "目的地", required: true }],
          slots: [], conflicts: [], questions: [], assumptions: [], capabilityCalls: [{ capability: "profile-retrieval", query: "travel", status: "success" }],
        },
      },
    });
    const cardPlan = await beginStepCapture({ runId: run.id, step: "card_plan_generate", request: { plan: true } });
    await completeStepCapture({ runId: run.id, stepRunId: cardPlan.id, step: "card_plan_generate", output: { cardPlan: plan(2) } });
    const stored = await getLearningDatabase().taskRuns.get(run.id);
    expect(stored?.domains).toEqual(["travel"]);
    expect(stored?.slotNames).toEqual(["destination"]);
    expect(stored?.capabilities).toEqual(["profile-retrieval"]);
  });

  it("stores an accepted unbounded card plan and creates a pending SkillCandidate", async () => {
    const accepted = episode("episode_many_cards");
    await startTaskRun({ episodeId: accepted.id, query: accepted.query, classification, layoutMode: "free" });
    const candidate = await acceptTaskRunAndCreateCandidate({ episode: accepted, finalOpenUI: accepted.finalOpenUI!, cardPlan: plan(25) });
    expect(candidate?.status).toBe("pending-comparison");
    expect((await getLearningDatabase().taskRuns.get(`run_${accepted.id}`))?.skillCandidateStatus).toBe("pending-comparison");
  });

  it("creates a lightweight fork and reconstructs its materialized recipe", async () => {
    const firstEpisode = episode("episode_root");
    await startTaskRun({ episodeId: firstEpisode.id, query: firstEpisode.query, classification, layoutMode: "free" });
    const rootCandidate = await acceptTaskRunAndCreateCandidate({ episode: firstEpisode, finalOpenUI: firstEpisode.finalOpenUI!, cardPlan: plan(2) });
    const rootSkill = await resolveSkillCandidate({ candidateId: rootCandidate!.id, resolution: "new-skill", name: "旅行规划" });

    const forkEpisode = episode("episode_fork");
    await startTaskRun({ episodeId: forkEpisode.id, query: forkEpisode.query, classification, layoutMode: "fixed-600x300" });
    const forkPlan = plan(3);
    forkPlan.layoutPolicy = { mode: "fixed-600x300", cardWidth: 600, cardHeight: 300, overflow: "forbid", innerScroll: false };
    const forkCandidate = await acceptTaskRunAndCreateCandidate({ episode: forkEpisode, finalOpenUI: forkEpisode.finalOpenUI!, cardPlan: forkPlan });
    const fork = await resolveSkillCandidate({
      candidateId: forkCandidate!.id, resolution: "fork", name: "固定卡片旅行规划",
      baseSkillId: rootSkill.id, baseVersionId: rootSkill.activeVersionId,
    });
    const version = await getLearningDatabase().skillVersions.get(fork.activeVersionId);
    expect(version?.storageMode).toBe("delta");
    expect((await materializeSkillRecipe(version!.id)).cardPlanRecipe.layoutPolicy).toBe("fixed-600x300");
  });

  it("exports a self-contained sanitized package and rejects tampering", async () => {
    const accepted = episode("episode_export");
    await startTaskRun({ episodeId: accepted.id, query: "我的孩子住址和旅行计划", classification, layoutMode: "free" });
    const candidate = await acceptTaskRunAndCreateCandidate({ episode: accepted, finalOpenUI: accepted.finalOpenUI!, cardPlan: plan(2) });
    const skill = await resolveSkillCandidate({ candidateId: candidate!.id, resolution: "new-skill", name: "家庭旅行" });
    const bundle = await exportSkillPackage(skill.id);
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("我的孩子住址");
    expect(serialized).not.toMatch(/https?:\/\//);
    const imported = await importSkillPackage(bundle);
    expect(imported.status).toBe("imported-inactive");

    const tampered = structuredClone(bundle);
    tampered.skill.name = "被篡改";
    tampered.version.examples.push({ hidden: true });
    await expect(importSkillPackage(tampered)).rejects.toThrow("校验和");
  });

  it("exports a generic travel template while keeping the concrete destination private", async () => {
    const accepted = { ...episode("episode_beijing"), query: "去北京旅游" };
    await startTaskRun({ episodeId: accepted.id, query: accepted.query, classification, layoutMode: "free" });
    const abstraction = {
      formatVersion: "genui-query-abstraction/1" as const,
      intentKey: "travel_planning", displayName: "旅游", invariantSummary: "规划一次符合约束的旅行",
      invariantTerms: ["旅行", "规划"],
      parameters: [{ key: "destination", label: "目的地", valueKind: "location" as const, value: "北京", source: "query" as const, confidence: 0.99 }],
      constraints: [], confidence: 0.98,
    };
    const candidate = await acceptTaskRunAndCreateCandidate({
      episode: accepted, finalOpenUI: accepted.finalOpenUI!, cardPlan: plan(2), queryAbstraction: abstraction,
      inferenceState: {
        taskType: "旅行规划", needsContext: false,
        slotRequirements: [{ name: "destination", label: "目的地", description: "旅行目的地", required: true, explicitValue: "北京" }],
        slots: [{ name: "destination", value: "北京", evidence: "用户明确输入", source_record: "query", confidence: 1, status: "high" }],
        conflicts: [], questions: [], assumptions: [],
      },
    });
    const skill = await resolveSkillCandidate({ candidateId: candidate!.id, resolution: "new-skill", name: "旅行规划" });
    const bundle = await exportSkillPackage(skill.id);
    expect(bundle.packageVersion).toBe("genui-skill/3");
    expect(bundle.version.recipe.intentTemplate.intentKey).toBe("travel_planning");
    expect(bundle.version.recipe.intentTemplate.parameters.map((parameter) => parameter.key)).toContain("destination");
    expect(JSON.stringify(bundle)).not.toContain("北京");
  });
});

describe("v1 migration", () => {
  it("keeps legacy episodes and creates legacy-summary TaskRuns", async () => {
    const name = `learning-migration-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores({ episodes: "id", policies: "id", policyObservations: "id", settings: "id" });
    await old.table("episodes").put(episode("legacy_episode"));
    old.close();
    const upgraded = new LearningDatabase(name);
    await upgraded.open();
    const run = await upgraded.taskRuns.get("legacy_run_legacy_episode");
    expect(run?.captureCompleteness).toBe("legacy-summary");
    expect(await upgraded.episodes.get("legacy_episode")).toBeTruthy();
    upgraded.close();
    await Dexie.delete(name);
  });
});
