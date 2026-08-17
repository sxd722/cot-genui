import "server-only";

import { createHash } from "node:crypto";
import type OpenAI from "openai";
import { createLLMClient, extractJson } from "@/lib/llm";
import type { ProfileDigest, ProfileDomain, RetrievedEvidence, RetrievalRequest } from "@/lib/profileTypes";

interface FlatRecord {
  path: string;
  value: unknown;
  text: string;
  domain: string;
}

const profileCache = new Map<string, ProfileDigest>();
const MAX_CHUNK_CHARS = 8_000;
const MAX_CHUNKS = 8;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contextHash(context: Record<string, unknown>): string {
  return createHash("sha256").update(stable(context)).digest("hex");
}

function flatten(value: unknown, path = "", domain = "general", output: FlatRecord[] = []): FlatRecord[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, domain, output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const nextPath = path ? `${path}.${key}` : key;
      flatten(item, nextPath, path ? domain : key, output);
    });
    return output;
  }
  output.push({ path, value, domain, text: `${path}: ${String(value ?? "")}` });
  return output;
}

function chunks(records: FlatRecord[]): string[] {
  const grouped = new Map<string, string[]>();
  records.forEach((record) => grouped.set(record.domain, [...(grouped.get(record.domain) ?? []), record.text]));
  const result: string[] = [];
  let packed = "";
  grouped.forEach((lines, domain) => {
    let current = `domain=${domain}\n`;
    lines.forEach((line) => {
      if (current.length + line.length > MAX_CHUNK_CHARS && current.length > 100) {
        if (packed) result.push(packed);
        packed = current;
        current = `domain=${domain}\n`;
      }
      current += `${line}\n`;
    });
    if (current.length <= 20) return;
    if (packed.length + current.length > MAX_CHUNK_CHARS && packed) {
      result.push(packed);
      packed = current;
    } else {
      packed += current;
    }
  });
  if (packed) result.push(packed);
  return result.slice(0, MAX_CHUNKS);
}

function deterministicDigest(context: Record<string, unknown>, hash: string): ProfileDigest {
  const records = flatten(context);
  const domainMap = new Map<string, FlatRecord[]>();
  records.forEach((record) => domainMap.set(record.domain, [...(domainMap.get(record.domain) ?? []), record]));
  const domains: ProfileDomain[] = [...domainMap.entries()].map(([name, items]) => ({
    name,
    summary: `${name} 领域包含 ${items.length} 条可检索记录`,
    availableSignals: items.slice(0, 12).map((item) => item.path.split(".").at(-1) ?? item.path),
    recordCount: items.length,
    retrievalKeys: [name, ...items.slice(0, 10).map((item) => item.path)],
  }));
  const pick = (patterns: RegExp[]) => records.filter((record) => patterns.some((pattern) => pattern.test(record.path))).slice(0, 8).map((record) => `${record.path}=${String(record.value)}`);
  return {
    contextHash: hash,
    version: "v1",
    generatedAt: new Date().toISOString(),
    core: {
      demographics: pick([/identity\.(age|gender|name)/i]),
      homeAndWork: pick([/location|company|work/i]),
      household: pick([/family|children|spouse|parents/i]),
      occupation: pick([/occupation|company|work_years/i]),
      financialPosture: pick([/payment|income|saving|budget|mortgage/i]),
      healthConstraints: pick([/health|dietary|chronic|allerg/i]),
      persistentPreferences: pick([/preference|preferred|persona_tags/i]),
    },
    traits: [],
    domains,
    salientSignals: records.slice(0, 20).map((record) => ({ fact: record.text, domain: record.domain, confidence: 0.7, sourceRefs: [record.path] })),
    conflicts: [],
    degraded: true,
  };
}

async function jsonCompletion(system: string, user: unknown): Promise<Record<string, unknown>> {
  const client = createLLMClient();
  const params = {
    model: "glm-5.2",
    messages: [
      { role: "system" as const, content: `${system}\n只返回合法 JSON，不要输出 markdown。` },
      { role: "user" as const, content: JSON.stringify(user) },
    ],
    response_format: { type: "json_object" as const },
    temperature: 0.1,
    thinking: { type: "disabled" },
    do_sample: true,
  } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming;
  const completion = await client.chat.completions.create(params);
  return extractJson(completion.choices[0]?.message?.content ?? "") as Record<string, unknown>;
}

/** 使用 GLM-5.2 thinking 对自由文本个人上下文做画像索引 */
export async function compressFreeText(freeText: string): Promise<{ digest: ProfileDigest; cacheHit: boolean }> {
  const hash = createHash("sha256").update(freeText).digest("hex");
  const cacheKey = `freetext:${hash}`;
  const cached = profileCache.get(cacheKey);
  if (cached) return { digest: cached, cacheHit: true };

  // 降级 digest：从文本中提取简单信息
  const fallback: ProfileDigest = {
    contextHash: hash,
    version: "v1",
    generatedAt: new Date().toISOString(),
    core: {
      demographics: [],
      homeAndWork: [],
      household: [],
      occupation: [],
      financialPosture: [],
      healthConstraints: [],
      persistentPreferences: [],
    },
    traits: [],
    domains: [{ name: "free_text", summary: "用户提供的自由文本上下文", availableSignals: [freeText.slice(0, 100)], recordCount: 1, retrievalKeys: ["free_text"] }],
    salientSignals: [{ fact: freeText.slice(0, 200), domain: "free_text", confidence: 0.7, sourceRefs: ["free_text"] }],
    conflicts: [],
    degraded: true,
  };

  if (!process.env.LLM_API_KEY) {
    return { digest: fallback, cacheHit: false };
  }

  try {
    const client = createLLMClient();
    const params = {
      model: "glm-5.2",
      messages: [
        {
          role: "system" as const,
          content: `你是一个用户画像索引引擎。用户会提供一段自由文本形式的个人上下文（可能包含个人信息、家庭情况、工作、消费习惯、健康状况、设备使用记录等）。
请深度分析这段文本，提取结构化的用户画像，用于后续的意图推理。

输出 JSON，结构如下：
{
  "core": {
    "demographics": ["年龄、性别、姓名等"],
    "homeAndWork": ["居住地、工作地、通勤等"],
    "household": ["家庭结构、成员、宠物等"],
    "occupation": ["职业、行业、工作年限等"],
    "financialPosture": ["收入、储蓄、消费风格、负债等"],
    "healthConstraints": ["健康状况、饮食约束等"],
    "persistentPreferences": ["长期偏好、性格标签等"]
  },
  "traits": [{"trait": "标签", "confidence": 0.0-1.0, "domains": ["相关领域"], "sourceRefs": ["原文出处"]}],
  "domains": [{"name": "领域名", "summary": "领域摘要", "availableSignals": ["可用信号"], "recordCount": 数量, "retrievalKeys": ["检索关键词"]}],
  "salientSignals": [{"fact": "关键事实", "domain": "领域", "confidence": 0.0-1.0, "sourceRefs": ["原文出处"]}],
  "conflicts": [{"topic": "冲突主题", "description": "冲突描述", "sourceRefs": ["出处"]}]
}

要求：
- 深度推理，不要只做表面提取——从文本中推断隐含信息（如"有房贷"→"有一定财务压力"）
- 标注置信度：直接陈述的事实0.9+，推断的0.5-0.8，不确定的<0.5
- 识别潜在冲突（如"预算敏感"vs"消费风格舒适"）
- sourceRefs 引用原文片段
- 只返回合法 JSON，不要输出 markdown。`,
        },
        { role: "user" as const, content: freeText },
      ],
      response_format: { type: "json_object" as const },
      temperature: 0.15,
      thinking: { type: "enabled", include_braincontent: false },
    } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming;

    const completion = await client.chat.completions.create(params);
    const reduced = extractJson(completion.choices[0]?.message?.content ?? "") as Record<string, unknown>;

    const digest: ProfileDigest = {
      ...fallback,
      ...(reduced as unknown as Partial<ProfileDigest>),
      contextHash: hash,
      version: "v1",
      generatedAt: new Date().toISOString(),
      degraded: false,
    };
    profileCache.set(cacheKey, digest);
    return { digest, cacheHit: false };
  } catch {
    return { digest: fallback, cacheHit: false };
  }
}

export async function compressProfile(context: Record<string, unknown>): Promise<{ digest: ProfileDigest; cacheHit: boolean }> {
  const hash = contextHash(context);
  const cacheKey = `json:${hash}`;
  const cached = profileCache.get(cacheKey);
  if (cached) return { digest: cached, cacheHit: true };
  const fallback = deterministicDigest(context, hash);
  if (!process.env.LLM_API_KEY) {
    return { digest: fallback, cacheHit: false };
  }

  try {
    const sourceChunks = chunks(flatten(context));
    const partials = sourceChunks.length === 1 ? [] : await Promise.all(sourceChunks.map((chunk) => jsonCompletion(
      "你负责对一段与具体 query 无关的用户记录做通用画像提取。保留稳定事实、长期偏好、近期高价值信号、潜在冲突、精确 sourceRefs；不要根据未来任务筛掉领域。输出 {domain,summary,availableSignals:string[],facts:[{fact,confidence,observedAt?,sourceRefs:string[]}],traits:[{trait,confidence,sourceRefs:string[]}],conflicts:[{topic,description,sourceRefs:string[]}]}",
      { records: chunk },
    )));
    const reduced = await jsonCompletion(
      "你负责把多个领域摘要合并成 query-independent 的通用画像胶囊。不能虚构；sourceRefs 原样保留。L0 用于让后续模型知道用户特征以及还有哪些领域证据可检索，而不是替代原始证据。输出 {core:{demographics:string[],homeAndWork:string[],household:string[],occupation:string[],financialPosture:string[],healthConstraints:string[],persistentPreferences:string[]},traits:[{trait,confidence,domains:string[],sourceRefs:string[]}],domains:[{name,summary,availableSignals:string[],recordCount:number,freshness?,retrievalKeys:string[]}],salientSignals:[{fact,domain,confidence,observedAt?,sourceRefs:string[]}],conflicts:[{topic,description,sourceRefs:string[]}]}",
      sourceChunks.length === 1
        ? { rawRecords: sourceChunks[0], deterministicDomainDirectory: fallback.domains }
        : { partials, deterministicDomainDirectory: fallback.domains },
    );
    const digest: ProfileDigest = {
      ...fallback,
      ...(reduced as unknown as Partial<ProfileDigest>),
      contextHash: hash,
      version: "v1",
      generatedAt: new Date().toISOString(),
      degraded: false,
    };
    profileCache.set(cacheKey, digest);
    return { digest, cacheHit: false };
  } catch {
    return { digest: fallback, cacheHit: false };
  }
}

function terms(value: string): string[] {
  return value.toLowerCase().split(/[\s,，。；;：:、/|]+/).filter((item) => item.length >= 2);
}

export function retrieveProfileEvidence(
  context: Record<string, unknown>,
  requests: RetrievalRequest[],
  maxRecords = 40,
  maxChars = 6_000,
): RetrievedEvidence[] {
  const records = flatten(context);
  const requestedDomains = new Set(requests.flatMap((request) => request.domains ?? []).map((item) => item.toLowerCase()));
  const requestedPaths = requests.flatMap((request) => request.sourcePaths ?? []);
  const queryTerms = terms(requests.map((request) => `${request.semanticQuery} ${(request.slotNames ?? []).join(" ")}`).join(" "));
  const scored = records.map((record) => {
    const haystack = `${record.path} ${record.text}`.toLowerCase();
    let score = requestedDomains.has(record.domain.toLowerCase()) ? 8 : 0;
    if (requestedPaths.some((path) => record.path.startsWith(path))) score += 12;
    score += queryTerms.filter((term) => haystack.includes(term)).length * 2;
    if (/date|time|recent|latest|calendar/i.test(record.path)) score += 1;
    return { path: record.path, value: record.value, domain: record.domain, score };
  }).filter((record) => record.score > 0).sort((a, b) => b.score - a.score);
  const output: RetrievedEvidence[] = [];
  let used = 0;
  for (const record of scored) {
    const size = JSON.stringify(record).length;
    if (output.length >= maxRecords || used + size > maxChars) break;
    output.push(record);
    used += size;
  }
  return output;
}
