import { z } from "zod";
import { getLearningDatabase } from "./database";
import { byteSize, canonicalJson, createLearningId, sha256 } from "./hash";
import { getArtifactPayload } from "./workflowCapture";
import { upgradeSkillRecipe, validateSkillRecipe } from "./skillRecipe";
import type {
  ArtifactRecord,
  GenUISkillPackage,
  SkillCandidateRecord,
  SkillIndexProfile,
  SkillRecipe,
  StoredSkillRecipe,
  SkillRecord,
  SkillVersionRecord,
} from "./workflowTypes";

const packageSchema = z.object({
  packageVersion: z.enum(["genui-skill/1", "genui-skill/2", "genui-skill/3"]),
  exportedAt: z.string(),
  skill: z.object({
    slug: z.string().min(1).max(120),
    name: z.string().min(1).max(160),
    description: z.string().max(1_000),
    tags: z.array(z.string().max(80)).max(30),
  }),
  version: z.object({
    recipe: z.object({ formatVersion: z.enum(["genui-skill-recipe/1", "genui-skill-recipe/2", "genui-skill-recipe/3"]) }).passthrough(),
    indexProfile: z.object({
      taskFamilies: z.array(z.string()), decisionModes: z.array(z.string()), language: z.string(), domains: z.array(z.string()),
      intentTerms: z.array(z.string()), slotKeys: z.array(z.string()), profileDomains: z.array(z.string()), capabilities: z.array(z.string()),
      cardArchetypes: z.array(z.string()), layoutModes: z.array(z.string()), actionTypes: z.array(z.string()),
      requiresFreshData: z.boolean(), semanticText: z.string(), embedding: z.array(z.number()).optional(), embeddingModel: z.string().optional(),
    }).passthrough(),
    compatibility: z.array(z.string()),
    examples: z.array(z.unknown()).max(20),
  }),
  checksums: z.object({ recipe: z.string(), examples: z.array(z.string()), bundle: z.string() }),
});

const SAFE_CAPABILITIES = new Set(["web-search", "profile-retrieval", "host-image-search", "card-edit"]);
const DANGEROUS_KEY = /(?:api[_-]?key|authorization|cookie|secret|token|deviceContext|profileView|originalQuery|userKey|sourceRunId)/i;
const URL_PATTERN = /(?:https?:\/\/|data:|javascript:|file:\/\/)/i;
const CODE_PATTERN = /(?:<script|\beval\s*\(|\bFunction\s*\(|\brequire\s*\(|\bimport\s*\()/i;

function assertShareSafe(value: unknown, path = "$" ) {
  if (typeof value === "string" && (URL_PATTERN.test(value) || CODE_PATTERN.test(value))) {
    throw new Error(`Skill 包含不允许的 URL 或可执行内容：${path}`);
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertShareSafe(item, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (DANGEROUS_KEY.test(key)) throw new Error(`Skill 包含私有字段：${path}.${key}`);
    assertShareSafe(item, `${path}.${key}`);
  }
}

function slugify(value: string) {
  const slug = value.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 100);
  return slug || `skill-${Date.now().toString(36)}`;
}

function mergePatch(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result: Record<string, unknown> = base && typeof base === "object" && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

export function createJsonMergePatch(base: unknown, target: unknown): unknown {
  if (canonicalJson(base) === canonicalJson(target)) return {};
  if (!base || !target || typeof base !== "object" || typeof target !== "object" || Array.isArray(base) || Array.isArray(target)) return target;
  const output: Record<string, unknown> = {};
  const left = base as Record<string, unknown>;
  const right = target as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!(key in right)) output[key] = null;
    else if (!(key in left)) output[key] = right[key];
    else {
      const child = createJsonMergePatch(left[key], right[key]);
      if (canonicalJson(child) !== "{}") output[key] = child;
    }
  }
  return output;
}

async function putShareableArtifact(kind: "skill-recipe" | "skill-recipe-patch", payload: unknown, skillVersionId: string): Promise<ArtifactRecord> {
  assertShareSafe(payload);
  const database = getLearningDatabase();
  const contentHash = await sha256(payload);
  const artifact: ArtifactRecord = {
    id: createLearningId("artifact"), skillVersionId, kind, schemaVersion: 1, contentHash,
    sensitivity: "shareable", redactionStatus: "redacted", createdAt: new Date().toISOString(),
  };
  await database.artifactContents.put({ contentHash, codec: "structured-clone", byteSize: byteSize(payload), payload });
  await database.artifacts.put(artifact);
  return artifact;
}

async function materializeStoredSkillRecipe(versionId: string, visited = new Set<string>()): Promise<StoredSkillRecipe> {
  if (visited.has(versionId)) throw new Error("Skill 版本依赖存在循环");
  visited.add(versionId);
  const database = getLearningDatabase();
  const version = await database.skillVersions.get(versionId);
  if (!version) throw new Error(`Skill 版本不存在：${versionId}`);
  if (version.storageMode === "snapshot") {
    const recipe = version.recipeArtifactId ? await getArtifactPayload<StoredSkillRecipe>(version.recipeArtifactId) : undefined;
    if (!recipe) throw new Error("Skill snapshot 缺少 recipe");
    return recipe;
  }
  if (!version.baseVersionId || !version.patchArtifactId) throw new Error("Skill delta 缺少 baseVersionId 或 patch");
  const [base, patch] = await Promise.all([
    materializeStoredSkillRecipe(version.baseVersionId, visited),
    getArtifactPayload(version.patchArtifactId),
  ]);
  return mergePatch(base, patch) as StoredSkillRecipe;
}

export async function materializeSkillRecipe(versionId: string): Promise<SkillRecipe> {
  return upgradeSkillRecipe(await materializeStoredSkillRecipe(versionId));
}

export async function resolveSkillCandidate(input: {
  candidateId: string;
  resolution: "new-skill" | "fork";
  name: string;
  description?: string;
  tags?: string[];
  baseSkillId?: string;
  baseVersionId?: string;
}): Promise<SkillRecord> {
  const database = getLearningDatabase();
  const candidate = await database.skillCandidates.get(input.candidateId);
  if (!candidate || candidate.status !== "pending-comparison") throw new Error("SkillCandidate 不存在或已处理");
  const storedCandidateRecipe = await getArtifactPayload<StoredSkillRecipe>(candidate.candidateRecipeArtifactId);
  const candidateRecipe = storedCandidateRecipe ? validateSkillRecipe(storedCandidateRecipe) : undefined;
  if (!candidateRecipe) throw new Error("SkillCandidate 缺少 recipe");
  assertShareSafe(candidateRecipe);
  if (input.resolution === "fork" && (!input.baseSkillId || !input.baseVersionId)) throw new Error("fork 需要 baseSkillId 和 baseVersionId");
  const timestamp = new Date().toISOString();
  const skillId = createLearningId("skill");
  const versionId = createLearningId("skillv");
  const recipeHash = await sha256(candidateRecipe);
  let recipeArtifactId: string | undefined;
  let patchArtifactId: string | undefined;
  let storageMode: SkillVersionRecord["storageMode"] = "snapshot";
  if (input.resolution === "fork") {
    const base = await materializeSkillRecipe(input.baseVersionId!);
    const patch = createJsonMergePatch(base, candidateRecipe);
    patchArtifactId = (await putShareableArtifact("skill-recipe-patch", patch, versionId)).id;
    storageMode = "delta";
  } else {
    recipeArtifactId = (await putShareableArtifact("skill-recipe", candidateRecipe, versionId)).id;
  }
  const example = await database.skillExamples.get(candidate.candidateExampleId);
  if (example) await database.skillExamples.update(example.id, { skillVersionId: versionId });
  const bundleHash = await sha256({ recipeHash, exampleIds: example ? [example.id] : [] });
  const skill: SkillRecord = {
    id: skillId, slug: `${slugify(input.name)}-${skillId.slice(-6)}`, name: input.name,
    description: input.description ?? "从已接受生成任务提炼的可复用工作流", status: "active",
    tags: input.tags ?? [], activeVersionId: versionId,
    forkedFromSkillId: input.resolution === "fork" ? input.baseSkillId : undefined,
    createdAt: timestamp, updatedAt: timestamp,
  };
  const version: SkillVersionRecord = {
    id: versionId, skillId, version: 1, status: "published", storageMode,
    baseVersionId: input.resolution === "fork" ? input.baseVersionId : undefined,
    recipeArtifactId, patchArtifactId, exampleIds: example ? [example.id] : [], recipeFingerprint: recipeHash, bundleHash,
    indexProfile: candidate.indexProfile, compatibility: ["six-step-v1", "genui-skill-recipe/3"],
    taskFamilies: candidate.taskFamilies, domains: candidate.domains, createdAt: timestamp,
  };
  await database.transaction("rw", database.skills, database.skillVersions, database.skillCandidates, database.taskRuns, async () => {
    await database.skills.put(skill);
    await database.skillVersions.put(version);
    await database.skillCandidates.update(candidate.id, {
      status: "resolved", resolvedSkillId: skill.id, resolvedAt: timestamp,
      proposedBaseSkillId: input.baseSkillId, proposedBaseVersionId: input.baseVersionId,
    });
    await database.taskRuns.update(candidate.runId, { skillCandidateStatus: input.resolution === "fork" ? "forked" : "new-skill", updatedAt: timestamp });
  });
  return skill;
}

export async function exportSkillPackage(skillId: string): Promise<GenUISkillPackage> {
  const database = getLearningDatabase();
  const skill = await database.skills.get(skillId);
  if (!skill) throw new Error("Skill 不存在");
  const version = await database.skillVersions.get(skill.activeVersionId);
  if (!version) throw new Error("Skill 当前版本不存在");
  const recipe = await materializeSkillRecipe(version.id);
  const compatibility = [...new Set([
    ...version.compatibility.filter((item) => !["genui-skill-recipe/1", "genui-skill-recipe/2"].includes(item)),
    "six-step-v1", "genui-skill-recipe/3",
  ])];
  const examples = (await Promise.all(version.exampleIds.map(async (id) => {
    const example = await database.skillExamples.get(id);
    return example ? getArtifactPayload(example.artifactId) : undefined;
  }))).filter((value) => value !== undefined);
  assertShareSafe({ recipe, examples });
  const recipeChecksum = await sha256(recipe);
  const exampleChecksums = await Promise.all(examples.map(sha256));
  const bundle = await sha256({
    skill: { slug: skill.slug, name: skill.name, description: skill.description, tags: skill.tags },
    recipe: recipeChecksum, examples: exampleChecksums, indexProfile: version.indexProfile, compatibility,
  });
  return {
    packageVersion: "genui-skill/3", exportedAt: new Date().toISOString(),
    skill: { slug: skill.slug, name: skill.name, description: skill.description, tags: skill.tags },
    version: { recipe, indexProfile: version.indexProfile, compatibility, examples },
    checksums: { recipe: recipeChecksum, examples: exampleChecksums, bundle },
  };
}

export async function importSkillPackage(raw: unknown): Promise<SkillRecord> {
  const parsed = packageSchema.parse(raw) as unknown as GenUISkillPackage;
  assertShareSafe(parsed.version);
  const disallowed = parsed.version.indexProfile.capabilities.filter((item) => !SAFE_CAPABILITIES.has(item));
  if (disallowed.length) throw new Error(`Skill 使用未授权 capability：${disallowed.join(", ")}`);
  const recipeChecksum = await sha256(parsed.version.recipe);
  const exampleChecksums = await Promise.all(parsed.version.examples.map(sha256));
  const bundleChecksum = await sha256({
    skill: parsed.skill, recipe: recipeChecksum, examples: exampleChecksums,
    indexProfile: parsed.version.indexProfile, compatibility: parsed.version.compatibility,
  });
  if (recipeChecksum !== parsed.checksums.recipe
    || canonicalJson(exampleChecksums) !== canonicalJson(parsed.checksums.examples)
    || bundleChecksum !== parsed.checksums.bundle) throw new Error("Skill 包校验和不匹配");
  const normalizedRecipe = validateSkillRecipe(parsed.version.recipe);
  const normalizedRecipeChecksum = await sha256(normalizedRecipe);
  const normalizedBundleChecksum = await sha256({
    skill: parsed.skill, recipe: normalizedRecipeChecksum, examples: exampleChecksums,
    indexProfile: parsed.version.indexProfile,
    compatibility: [...new Set([
      ...parsed.version.compatibility.filter((item) => !["genui-skill-recipe/1", "genui-skill-recipe/2"].includes(item)),
      "six-step-v1", "genui-skill-recipe/3",
    ])],
  });
  const database = getLearningDatabase();
  const timestamp = new Date().toISOString();
  const skillId = createLearningId("skill");
  const versionId = createLearningId("skillv");
  const recipeArtifact = await putShareableArtifact("skill-recipe", normalizedRecipe, versionId);
  const importedExamples: Array<{ id: string; artifactId: string }> = [];
  for (const payload of parsed.version.examples) {
    const contentHash = await sha256(payload);
    const artifactId = createLearningId("artifact");
    const exampleId = createLearningId("example");
    await database.artifactContents.put({ contentHash, codec: "structured-clone", byteSize: byteSize(payload), payload });
    await database.artifacts.put({
      id: artifactId, skillVersionId: versionId, kind: "skill-example", schemaVersion: 1, contentHash,
      sensitivity: "sanitized", redactionStatus: "redacted", createdAt: timestamp,
    });
    importedExamples.push({ id: exampleId, artifactId });
  }
  const skill: SkillRecord = {
    id: skillId, slug: `${slugify(parsed.skill.slug)}-${skillId.slice(-6)}`, name: parsed.skill.name,
    description: parsed.skill.description, status: "imported-inactive", tags: parsed.skill.tags,
    activeVersionId: versionId, createdAt: timestamp, updatedAt: timestamp,
  };
  const version: SkillVersionRecord = {
    id: versionId, skillId, version: 1, status: "published", storageMode: "snapshot", recipeArtifactId: recipeArtifact.id,
    exampleIds: importedExamples.map((item) => item.id), recipeFingerprint: normalizedRecipeChecksum, bundleHash: normalizedBundleChecksum,
    indexProfile: parsed.version.indexProfile as SkillIndexProfile,
    compatibility: [...new Set([
      ...parsed.version.compatibility.filter((item) => !["genui-skill-recipe/1", "genui-skill-recipe/2"].includes(item)),
      "six-step-v1", "genui-skill-recipe/3",
    ])],
    taskFamilies: parsed.version.indexProfile.taskFamilies, domains: parsed.version.indexProfile.domains, createdAt: timestamp,
  };
  await database.transaction("rw", database.skills, database.skillVersions, database.skillExamples, async () => {
    await database.skills.put(skill);
    await database.skillVersions.put(version);
    await database.skillExamples.bulkPut(importedExamples.map((item) => ({
      id: item.id, skillVersionId: versionId, artifactId: item.artifactId, qualityTier: "curated" as const, createdAt: timestamp,
    })));
  });
  return skill;
}

export async function discardSkillCandidate(candidate: SkillCandidateRecord): Promise<void> {
  const database = getLearningDatabase();
  await database.transaction("rw", database.skillCandidates, database.taskRuns, async () => {
    await database.skillCandidates.update(candidate.id, { status: "discarded", resolvedAt: new Date().toISOString() });
    await database.taskRuns.update(candidate.runId, { skillCandidateStatus: "discarded", updatedAt: new Date().toISOString() });
  });
}

export async function setSkillStatus(skillId: string, status: "active" | "archived"): Promise<void> {
  const database = getLearningDatabase();
  const skill = await database.skills.get(skillId);
  if (!skill) throw new Error("Skill 不存在");
  await database.skills.update(skillId, { status, updatedAt: new Date().toISOString() });
}

export async function rollbackSkillVersion(skillId: string, versionId: string): Promise<void> {
  const database = getLearningDatabase();
  const [skill, target] = await Promise.all([database.skills.get(skillId), database.skillVersions.get(versionId)]);
  if (!skill || !target || target.skillId !== skillId) throw new Error("Skill 版本不存在");
  const timestamp = new Date().toISOString();
  await database.transaction("rw", database.skills, database.skillVersions, async () => {
    if (skill.activeVersionId !== target.id) await database.skillVersions.update(skill.activeVersionId, { status: "deprecated" });
    await database.skillVersions.update(target.id, { status: "published" });
    await database.skills.update(skill.id, { activeVersionId: target.id, status: "active", updatedAt: timestamp });
  });
}

export async function autoPublishSkillCandidate(input: {
  candidateId: string;
  name: string;
  sourceSkillId?: string;
}): Promise<SkillRecord> {
  if (!input.sourceSkillId) {
    return resolveSkillCandidate({
      candidateId: input.candidateId,
      resolution: "new-skill",
      name: input.name,
      description: "由零编辑接受任务自动提炼的可复用生成流程",
    });
  }
  const database = getLearningDatabase();
  const candidate = await database.skillCandidates.get(input.candidateId);
  const skill = await database.skills.get(input.sourceSkillId);
  if (!candidate || candidate.status !== "pending-comparison" || !skill || skill.status !== "active") {
    throw new Error("来源 Skill 或候选不可用于自动发布");
  }
  const activeVersion = await database.skillVersions.get(skill.activeVersionId);
  if (!activeVersion) throw new Error("来源 Skill 当前版本不存在");
  const stored = await getArtifactPayload<StoredSkillRecipe>(candidate.candidateRecipeArtifactId);
  if (!stored) throw new Error("SkillCandidate 缺少 recipe");
  const recipe = validateSkillRecipe(stored);
  assertShareSafe(recipe);
  const recipeFingerprint = await sha256(recipe);
  const example = await database.skillExamples.get(candidate.candidateExampleId);
  const timestamp = new Date().toISOString();
  if (recipeFingerprint === activeVersion.recipeFingerprint) {
    const exampleIds = example ? [...new Set([...activeVersion.exampleIds, example.id])] : activeVersion.exampleIds;
    const bundleHash = await sha256({ recipeFingerprint, exampleIds });
    await database.transaction("rw", database.skillVersions, database.skillExamples, database.skillCandidates, database.taskRuns, database.skills, async () => {
      await database.skillVersions.update(activeVersion.id, { exampleIds, bundleHash });
      if (example) await database.skillExamples.update(example.id, { skillVersionId: activeVersion.id });
      await database.skillCandidates.update(candidate.id, { status: "resolved", resolvedSkillId: skill.id, resolvedAt: timestamp });
      await database.taskRuns.update(candidate.runId, { skillCandidateStatus: "updated-skill", updatedAt: timestamp });
      await database.skills.update(skill.id, { updatedAt: timestamp });
    });
    return { ...skill, updatedAt: timestamp };
  }
  const versionId = createLearningId("skillv");
  const baseRecipe = await materializeSkillRecipe(activeVersion.id);
  const storedBase = activeVersion.storageMode === "snapshot" && activeVersion.recipeArtifactId
    ? await getArtifactPayload<StoredSkillRecipe>(activeVersion.recipeArtifactId)
    : undefined;
  const migrateLegacySnapshot = storedBase?.formatVersion === "genui-skill-recipe/1";
  const patchArtifact = migrateLegacySnapshot
    ? undefined
    : await putShareableArtifact("skill-recipe-patch", createJsonMergePatch(baseRecipe, recipe), versionId);
  const recipeArtifact = migrateLegacySnapshot
    ? await putShareableArtifact("skill-recipe", recipe, versionId)
    : undefined;
  const existingVersions = await database.skillVersions.where("skillId").equals(skill.id).toArray();
  const versionNumber = Math.max(0, ...existingVersions.map((item) => item.version)) + 1;
  const exampleIds = example ? [example.id] : [];
  const version: SkillVersionRecord = {
    id: versionId, skillId: skill.id, version: versionNumber, status: "published", storageMode: migrateLegacySnapshot ? "snapshot" : "delta",
    baseVersionId: migrateLegacySnapshot ? undefined : activeVersion.id,
    recipeArtifactId: recipeArtifact?.id,
    patchArtifactId: patchArtifact?.id,
    exampleIds,
    recipeFingerprint, bundleHash: await sha256({ recipeFingerprint, exampleIds }),
    indexProfile: candidate.indexProfile, compatibility: ["six-step-v1", "genui-skill-recipe/3"],
    taskFamilies: candidate.taskFamilies, domains: candidate.domains, createdAt: timestamp,
  };
  await database.transaction("rw", database.skillVersions, database.skillExamples, database.skillCandidates, database.taskRuns, database.skills, async () => {
    await database.skillVersions.update(activeVersion.id, { status: "deprecated" });
    await database.skillVersions.put(version);
    if (example) await database.skillExamples.update(example.id, { skillVersionId: version.id });
    await database.skills.update(skill.id, { activeVersionId: version.id, updatedAt: timestamp });
    await database.skillCandidates.update(candidate.id, { status: "resolved", resolvedSkillId: skill.id, resolvedAt: timestamp });
    await database.taskRuns.update(candidate.runId, { skillCandidateStatus: "updated-skill", updatedAt: timestamp });
  });
  return { ...skill, activeVersionId: version.id, updatedAt: timestamp };
}
