import "server-only";
import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inferResponseSchema, type InferResponse } from "./schemas";

/* ------------------------------------------------------------------ */
/*  LLM 客户端                                                         */
/* ------------------------------------------------------------------ */

export function createLLMClient(): OpenAI {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少 LLM_API_KEY 环境变量。请在 .env.local 中配置（可指向 OpenAI/GLM 等兼容端点）。",
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.LLM_BASE_URL,
  });
}

function loadSystemPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const promptPath = join(here, "..", "prompts", "system.md");
  return readFileSync(promptPath, "utf-8");
}

function loadCardPlanSpec(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const promptPath = join(here, "..", "prompts", "card-plan-spec.md");
  return readFileSync(promptPath, "utf-8");
}

function loadSemanticSpec(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const promptPath = join(here, "..", "prompts", "semantic-card-spec.md");
  return readFileSync(promptPath, "utf-8");
}

/* ------------------------------------------------------------------ */
/*  JSON 提取容错                                                       */
/*  很多兼容端点（GLM 等）即使指定了 response_format: json_schema，     */
/*  仍会用 ```json ... ``` 围栏包裹输出。这里统一做剥离 + 容错解析。      */
/* ------------------------------------------------------------------ */

export function extractJson(text: string): unknown {
  if (!text) throw new Error("模型返回空内容");
  let s = text.trim();

  // 1) 去除 markdown 代码围栏 ```json ... ``` 或 ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 2) 直接解析
  try {
    return JSON.parse(s);
  } catch {
    // 3) 截取第一个 { 到最后一个 } 之间
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const slice = s.slice(start, end + 1);
      return JSON.parse(slice);
    }
  }
  throw new Error("无法从模型输出中解析 JSON");
}

/* ------------------------------------------------------------------ */
/*  统一的 LLM 调用核心                                                 */
/*  - 尝试 structured output（json_schema strict）                      */
/*  - 端点不支持时自动降级为普通调用 + extractJson 容错                  */
/* ------------------------------------------------------------------ */

interface CallOptions {
  systemPrompt: string;
  userMessage: string;
  schema: object;
  schemaName: string;
  /** 调用日志回调（前端日志面板用） */
  onLog?: (entry: CallLog) => void;
}

export interface CallLog {
  ts: string;
  phase: "request" | "response" | "error" | "fallback";
  message: string;
  detail?: unknown;
}

async function callLLM(opts: CallOptions): Promise<unknown> {
  const client = createLLMClient();
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  const baseMessages = [
    { role: "system" as const, content: opts.systemPrompt },
    { role: "user" as const, content: opts.userMessage },
  ];

  const log = opts.onLog ?? (() => {});
  const ts = () => new Date().toISOString();
  log({ ts: ts(), phase: "request", message: `POST /chat/completions  model=${model}` });

  // 先尝试 structured output
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: baseMessages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: opts.schemaName,
          strict: true,
          schema: opts.schema,
        },
      } as OpenAI.ChatCompletionCreateParams["response_format"],
    });
    const content = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJson(content);
    log({ ts: ts(), phase: "response", message: "structured output 成功", detail: { usage: completion.usage } });
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log({ ts: ts(), phase: "fallback", message: `structured output 失败，降级为普通调用: ${msg}` });

    // 降级：普通调用，prompt 里强调只输出 JSON
    const completion = await client.chat.completions.create({
      model,
      messages: [
        ...baseMessages,
        {
          role: "system",
          content:
            "重要：只输出合法的 JSON，不要输出任何 markdown 围栏、解释文字或前后缀。直接以 { 开头、以 } 结尾。",
        },
      ],
    });
    const content = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJson(content);
    log({ ts: ts(), phase: "response", message: "降级调用成功（已剥离围栏）", detail: { usage: completion.usage } });
    return parsed;
  }
}

/* ------------------------------------------------------------------ */
/*  分步推理                                                            */
/*  8 个步骤，每步可独立调用；传 priorContext 把前序结果衔接进来。       */
/*  Step 0 slot_definition 让模型自行定义槽位——这是脱离预设场景的关键。 */
/* ------------------------------------------------------------------ */

export const STEP_NAMES = [
  "slot_definition",
  "surface_parse",
  "sufficiency_check",
  "context_mining",
  "conflict_detection",
  "triage",
  "clarifying_questions",
  "generate",
] as const;

export type StepName = (typeof STEP_NAMES)[number];

/** 单步推理的公共输入 */
export interface StepInput {
  /** 要执行的步骤名（必填） */
  name: StepName;
  query: string;
  deviceContext: Record<string, unknown>;
  /** 前序步骤已得到的结果（key 为 step name） */
  priorSteps?: Partial<Record<StepName, unknown>>;
  /** 用户对提问的回答（仅 generate 步会用上），key 为问题索引 */
  userAnswers?: Record<number, string>;
  /** generate 步生成模式：ir=结构化CardPlan / semantic=纯语义描述 */
  genMode?: "ir" | "semantic";
  /** 日志回调 */
  onLog?: (entry: CallLog) => void;
  /** mock 模式 */
  mock?: boolean;
}

/** 单步推理的输出结构 */
export interface StepOutput {
  name: StepName;
  reasoning: string;
  outputs: Record<string, unknown>;
  /** 该步提取/更新的槽位（context_mining/triage/conflict_detection 等会产生） */
  slots?: InferResponse["slots"];
  conflicts?: InferResponse["conflicts"];
  questions?: InferResponse["clarifying_questions"];
  /** generate 步会有 result */
  result?: InferResponse["result"];
  /** generate 步产出的 CardPlan IR（ir 模式） */
  cardPlan?: unknown;
  /** generate 步产出的纯语义卡片描述（semantic 模式） */
  semanticCards?: unknown;
  rawDurationMs: number;
}

const STEP_LABEL: Record<StepName, string> = {
  slot_definition: "⓪ 槽位定义",
  surface_parse: "① 表层解析",
  sufficiency_check: "② 充分性判定",
  context_mining: "③ 上下文挖掘",
  conflict_detection: "④ 冲突检测",
  triage: "⑤ 分流",
  clarifying_questions: "⑥ 最小化提问",
  generate: "⑦ 生成",
};

/** 单步输出的 JSON schema（宽松：要求 reasoning + outputs，其余可选） */
const stepOutputSchema = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    outputs: { type: "object", additionalProperties: true },
    slots: { type: "array", items: { type: "object", additionalProperties: true } },
    conflicts: { type: "array", items: { type: "object", additionalProperties: true } },
    questions: { type: "array", items: { type: "object", additionalProperties: true } },
    result: { type: "object", additionalProperties: true },
  },
  required: ["reasoning", "outputs"],
  additionalProperties: false,
} as const;

const STEP_INSTRUCTION: Record<StepName, string> = {
  slot_definition:
    "执行【Step 0: slot_definition 槽位定义】：只看 user_query（先不管 device_context）。判断这是什么类型的任务(task_type)，并【自行定义】完成该任务需要哪些信息槽位。每个槽位含 name(英文snake_case)/label(中文)/weight(1-5影响权重)/blocking(缺失是否阻塞)/description。把 task_type 放进 outputs.task_type，槽位数组放进 outputs.slot_schema。不要套用任何预设场景，槽位完全由 query 决定。",
  surface_parse:
    "执行【Step 1: surface_parse 表层解析】：解析用户请求的表层动作(verb)，对照前序 slot_definition 步定义的 slot_schema，列出 query 中已明确给出的槽位和仍缺失的槽位。",
  sufficiency_check:
    "执行【Step 2: sufficiency_check 充分性判定】：判断缺失的槽位是否影响最终输出可用性，决定是否需要从上下文挖掘。",
  context_mining:
    "执行【Step 3: context_mining 上下文挖掘】：对每个缺失的关键槽位，去 device_context 找证据，产出 name/value/evidence/source_record/confidence。把结果放进 slots 数组。",
  conflict_detection:
    "执行【Step 4: conflict_detection 冲突检测】：检查同一槽位是否存在多源证据互相矛盾，矛盾的放进 conflicts 数组，不要擅自裁决。",
  triage:
    "执行【Step 5: triage 分流】：根据置信度(>=0.75高/0.4-0.75中/<0.4低或冲突)给每个槽位标 status(high/medium/low/conflict)，更新 slots。",
  clarifying_questions:
    "执行【Step 6: clarifying_questions 最小化提问】：只针对低置信/冲突且阻塞关键决策的槽位，提出澄清问题，放进 questions 数组，标明 reason 和 blocking。每个问题必须提供 2-4 个 options（候选答案数组），让用户一键选择。",
  generate:
    "执行【Step 7: generate 生成】：基于已确定的槽位值【以及用户对提问的回答 user_answers（若有）】，设计一份 CardPlan 卡片方案。\n" +
    "CardPlan 的结构、可用 block/action 菜单、数据流语法见下方的「CardPlan IR 规范」。\n" +
    "你要做的是：选 block 类型 + 用前序推断的槽位值填内容 + 用 navigate/onSelect 连接卡片流程。\n" +
    "不是写代码，而是语义化的设计描述——编译器会翻译成可渲染的卡片。",
};

/** 执行单步推理 */
export async function runStep(input: StepInput): Promise<StepOutput> {
  const { name, query, deviceContext, priorSteps = {}, userAnswers, genMode = "ir", onLog, mock } = input;

  if (mock) {
    return mockStep(input);
  }

  const startedAt = Date.now();

  const systemPrompt = loadSystemPrompt();
  const userMessage = [
    "## 用户请求",
    query,
    "",
    // slot_definition 步无需"场景槽位定义"段——它正是来定义的；
    // 其余步骤通过下面的"前序步骤结果"看到 slot_definition 的产出。
    ...(name === "slot_definition"
      ? []
      : [
          "## 已定义的槽位 (来自前序 slot_definition 步，见下方前序结果中的 outputs.slot_schema)",
          "请以这些动态定义的槽位为准，不要套用其他预设场景。",
          "",
        ]),
    "## 设备使用记录 (device_context)",
    "```json",
    JSON.stringify(deviceContext, null, 2),
    "```",
    "",
    "## 前序步骤已完成的结果",
    priorSteps && Object.keys(priorSteps).length > 0
      ? "```json\n" + JSON.stringify(priorSteps, null, 2) + "\n```"
      : "（无，这是第一步）",
    "",
    // generate 步注入用户对提问的回答
    ...(name === "generate" && userAnswers && Object.keys(userAnswers).length > 0
      ? [
          "## 用户对提问的回答 (user_answers，必须严格遵守)",
          "```json",
          JSON.stringify(userAnswers, null, 2),
          "```",
          "",
        ]
      : []),
    // generate 步注入规范（按模式分支）
    ...(name === "generate" && genMode === "ir"
      ? ["## CardPlan IR 规范", loadCardPlanSpec(), ""]
      : []),
    ...(name === "generate" && genMode === "semantic"
      ? ["## 语义化卡片描述规范", loadSemanticSpec(), ""]
      : []),
    "## 本步任务",
    STEP_INSTRUCTION[name],
    "",
    "只完成本步任务。输出 JSON 必须包含 reasoning(本步推理过程,字符串) 和 outputs(本步结构化产出,对象)。" +
      (name === "slot_definition"
        ? "此外把 task_type 放进 outputs.task_type，把槽位数组放进 outputs.slot_schema。"
        : "") +
      (name === "context_mining" || name === "triage"
        ? "此外必须在【顶层】加一个 slots 数组字段（不要嵌套进 outputs），数组元素形如 {name,value,evidence,source_record,confidence,status}。"
        : "") +
      (name === "conflict_detection" ? "此外必须在【顶层】加一个 conflicts 数组字段（不要嵌套进 outputs）。" : "") +
      (name === "clarifying_questions" ? "此外必须在【顶层】加一个 questions 数组字段（不要嵌套进 outputs），每个元素形如 {question,reason,blocking,options:[2-4个候选答案字符串]}。" : "") +
      (name === "generate" && genMode === "ir"
        ? "此外必须在【顶层】加一个 cardPlan 对象字段（不要嵌套进 outputs），严格按上方 CardPlan IR 规范的结构输出。同时给出 result.summary(一句话总结) 和 result.assumptions(假设数组)。"
        : "") +
      (name === "generate" && genMode === "semantic"
        ? "此外必须在【顶层】加一个 semanticCards 数组字段（不要嵌套进 outputs），严格按上方「语义化卡片描述规范」输出每张卡的完整描述。同时给出 result.summary 和 result.assumptions。"
        : ""),
  ].join("\n");

  const parsed = (await callLLM({
    systemPrompt,
    userMessage,
    schema: stepOutputSchema,
    schemaName: `step_${name}`,
    onLog,
  })) as Record<string, unknown>;

  // 容错：模型可能把 slots/conflicts/questions/result 嵌套进 outputs，
  // 而非放在顶层。这里做一次"上提"，保证前端字段统一。
  const outputs = (parsed.outputs as Record<string, unknown>) ?? {};
  const pick = <T,>(top: unknown, key: string): T | undefined =>
    (top as T) ?? (outputs[key] as T);

  return {
    name,
    reasoning: String(parsed.reasoning ?? ""),
    outputs,
    slots: pick<StepOutput["slots"]>(parsed.slots, "slots"),
    conflicts: pick<StepOutput["conflicts"]>(parsed.conflicts, "conflicts"),
    questions: pick<StepOutput["questions"]>(parsed.questions, "questions"),
    result: pick<StepOutput["result"]>(parsed.result, "result"),
    cardPlan: pick<unknown>(parsed.cardPlan, "cardPlan"),
    semanticCards: pick<unknown>(parsed.semanticCards, "semanticCards"),
    rawDurationMs: Date.now() - startedAt,
  };
}

// runStep 的 name 通过 input.name 传入（见 StepInput 接口）

/* ------------------------------------------------------------------ */
/*  全流程（顺序执行 7 步，内部调用 runStep）                            */
/* ------------------------------------------------------------------ */

export async function runInference(input: {
  query: string;
  deviceContext: Record<string, unknown>;
  onLog?: (entry: CallLog) => void;
  mock?: boolean;
}): Promise<InferResponse> {
  const { query, deviceContext, onLog, mock } = input;
  const priorSteps: Partial<Record<StepName, unknown>> = {};
  const steps: InferResponse["steps"] = [];
  let slots: InferResponse["slots"] = [];
  let conflicts: InferResponse["conflicts"] = [];
  let questions: InferResponse["clarifying_questions"] = [];
  let result: InferResponse["result"] = {
    summary: "",
    cards: [],
    assumptions: [],
  };

  for (const name of STEP_NAMES) {
    const out = await runStep({
      name,
      query,
      deviceContext,
      priorSteps,
      onLog,
      mock,
    });
    priorSteps[name] = {
      reasoning: out.reasoning,
      outputs: out.outputs,
      ...(out.slots ? { slots: out.slots } : {}),
      ...(out.conflicts ? { conflicts: out.conflicts } : {}),
      ...(out.questions ? { questions: out.questions } : {}),
      ...(out.result ? { result: out.result } : {}),
    };
    steps.push({ name: out.name, reasoning: out.reasoning, outputs: out.outputs });
    if (out.slots) slots = out.slots as InferResponse["slots"];
    if (out.conflicts) conflicts = out.conflicts as InferResponse["conflicts"];
    if (out.questions) questions = out.questions as InferResponse["clarifying_questions"];
    if (out.result) result = out.result as InferResponse["result"];
  }

  return { steps, slots, conflicts, clarifying_questions: questions, result };
}

/** 旧的全流程 schema（保留给 runInference 兜底/参考） */
export { inferResponseSchema };

/* ------------------------------------------------------------------ */
/*  Mock（无 API key 时，仅 mockStep 用于分步；全流程走 runInference）   */
/* ------------------------------------------------------------------ */

function mockStep(input: StepInput): StepOutput {
  const name = input.name;
  const homeCity =
    (input.deviceContext.location_history as { home_city?: string } | undefined)?.home_city ?? "未知";
  const startedAt = Date.now();

  const table: Record<StepName, Omit<StepOutput, "name" | "rawDurationMs">> = {
    slot_definition: {
      reasoning: `根据 query「${input.query}」判断任务类型并自行定义所需槽位（mock 占位，实际由模型生成）。`,
      outputs: {
        task_type: "generic_task",
        slot_schema: [
          { name: "who", label: "对象", weight: 4, blocking: true, description: "任务相关的人" },
          { name: "when", label: "时间", weight: 4, blocking: false, description: "何时执行" },
          { name: "where", label: "地点", weight: 3, blocking: false, description: "相关地点" },
          { name: "preference", label: "偏好", weight: 2, blocking: false, description: "用户偏好" },
        ],
      },
    },
    surface_parse: {
      reasoning: `解析 query「${input.query}」的表层动作，对照 slot_schema 列出已给出/缺失的槽位。`,
      outputs: { verb: "执行任务", explicit_in_query: [], missing: ["who", "when", "where", "preference"] },
    },
    sufficiency_check: { reasoning: "多个关键槽位缺失，影响输出可用性，需从上下文挖掘。", outputs: { need_context_mining: true } },
    context_mining: { reasoning: `从 device_context 挖掘槽位证据。定位历史显示常驻${homeCity}。`, outputs: { mined: ["where→" + homeCity] }, slots: [
      { name: "where", value: homeCity, evidence: `定位历史显示常驻${homeCity}`, source_record: "location_history.home_city", confidence: 0.9, status: "high" },
      { name: "who", value: "", evidence: "上下文不足以确定对象", source_record: "—", confidence: 0.2, status: "low" },
    ] },
    conflict_detection: { reasoning: "未检测到强冲突（mock）。", outputs: { conflicts: [] }, conflicts: [] },
    triage: { reasoning: "地点高置信；对象低置信需提问。", outputs: { high: ["where"], low: ["who"] }, slots: [
      { name: "where", value: homeCity, evidence: `定位历史显示常驻${homeCity}`, source_record: "location_history.home_city", confidence: 0.9, status: "high" },
      { name: "who", value: "", evidence: "上下文不足以确定对象", source_record: "—", confidence: 0.2, status: "low" },
    ] },
    clarifying_questions: { reasoning: "对象无法推断，必须问。", outputs: { questions: 1 }, questions: [
      { question: "这个任务具体涉及谁/为谁做？", reason: "对象缺失且无法从上下文推断，影响任务方向", blocking: true, options: ["为自己", "为家人", "为朋友", "工作需要"] },
    ] },
    generate: { reasoning: "基于推断生成 CardPlan IR。", outputs: {}, result: {
      summary: `针对「${input.query}」的初步方案`,
      assumptions: [`假设地点相关：${homeCity}`],
    }, cardPlan: {
      skillName: input.query,
      iconText: "S",
      reasoning: "mock CardPlan",
      cards: [
        { id: "overview", purpose: "概览", blocks: [
          { kind: "hero", title: input.query, text: `常驻${homeCity}的方案` },
        ], actions: [{ id: "next", label: "查看详情", type: "navigate", targetCardId: "detail" }] },
        { id: "detail", purpose: "详情", blocks: [
          { kind: "summary", title: "方案详情", value: "基于已推断信息的方案", valueFromSlot: "destination" },
        ] },
      ],
    } },
  };

  return { name, rawDurationMs: Date.now() - startedAt, ...table[name] };
}

export { STEP_LABEL };
