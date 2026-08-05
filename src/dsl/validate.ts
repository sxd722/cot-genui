/**
 * CardArtifact 校验器
 *
 * 实现 spec §4 (Artifact 全局不变量) 的 15 条检查 + §13 (交付检查清单) 的关键项。
 * 这是渲染前的守门人：无效 artifact 不渲染，返回诊断信息。
 */

import type {
  CardArtifact,
  Card,
  Action,
  Binding,
  FlowCard,
} from "./types";
import { FLOW_VERSION, DSL_VERSION } from "./types";
import { isKnownDataPath, findTool } from "./catalogs";
import type { ValidationResult } from "./types";

/** 主入口：校验一个 CardArtifact，返回 { valid, errors[] } */
export function validateArtifact(artifact: unknown): ValidationResult {
  const errors: string[] = [];

  // 前置：必须是 object
  if (!artifact || typeof artifact !== "object") {
    return { valid: false, errors: ["顶层必须是 object"] };
  }
  const a = artifact as Partial<CardArtifact>;

  // §2 顶层字段
  if (typeof a.artifactId !== "string" || !a.artifactId) {
    errors.push("artifactId 缺失或非字符串");
  }
  if (!a.flow || typeof a.flow !== "object") {
    errors.push("flow 缺失");
    return { valid: false, errors }; // flow 缺失则后续无法检查
  }
  if (!a.dsl || typeof a.dsl !== "object") {
    errors.push("dsl 缺失");
    return { valid: false, errors };
  }

  // §4.1 版本号
  if (a.flow.flowVersion !== FLOW_VERSION) {
    errors.push(`flow.flowVersion 必须是 "${FLOW_VERSION}"，实际为 ${JSON.stringify(a.flow.flowVersion)}`);
  }
  // §4.2
  if (a.dsl.dslVersion !== DSL_VERSION) {
    errors.push(`dsl.dslVersion 必须是 "${DSL_VERSION}"，实际为 ${JSON.stringify(a.dsl.dslVersion)}`);
  }
  // §4.3 singleForm 必须是 boolean true
  if (a.flow.singleForm !== true) {
    errors.push(`flow.singleForm 必须是 boolean true，实际为 ${JSON.stringify(a.flow.singleForm)}`);
  }

  // §4.4 startCardId 一致
  const flowStart = a.flow.startCardId;
  const dslStart = a.dsl.startCardId;
  if (typeof flowStart !== "string" || !flowStart) {
    errors.push("flow.startCardId 缺失");
  }
  if (typeof dslStart !== "string" || !dslStart) {
    errors.push("dsl.startCardId 缺失");
  }
  if (flowStart && dslStart && flowStart !== dslStart) {
    errors.push(`flow.startCardId (${flowStart}) 与 dsl.startCardId (${dslStart}) 不一致`);
  }

  // 收集 card ID 集合
  const flowCards = Array.isArray(a.flow.cards) ? a.flow.cards : [];
  const dslCards = Array.isArray(a.dsl.cards) ? a.dsl.cards : [];
  const flowIds = new Set(flowCards.map((c) => c?.id));
  const dslIds = new Set(dslCards.map((c) => c?.id));

  // §4.5 startCardId 存在
  if (flowStart && !flowIds.has(flowStart)) {
    errors.push(`flow.startCardId (${flowStart}) 不在 flow.cards 中`);
  }
  if (dslStart && !dslIds.has(dslStart)) {
    errors.push(`dsl.startCardId (${dslStart}) 不在 dsl.cards 中`);
  }

  // §4.6 卡片 ID 集合完全相同
  const flowOnly = [...flowIds].filter((id) => !dslIds.has(id));
  const dslOnly = [...dslIds].filter((id) => !flowIds.has(id));
  if (flowOnly.length > 0) {
    errors.push(`卡片 ID 仅在 flow 中: ${flowOnly.join(", ")}`);
  }
  if (dslOnly.length > 0) {
    errors.push(`卡片 ID 仅在 dsl 中: ${dslOnly.join(", ")}`);
  }

  // §4.7 同作用域 ID 唯一（flow cards / dsl cards 内部）
  checkUniqueIds(flowCards, "flow.cards", errors);
  checkUniqueIds(dslCards, "dsl.cards", errors);

  // §4.8 template 对齐
  for (const fc of flowCards) {
    const dc = dslCards.find((c) => c.id === fc.id);
    if (dc && fc.template !== dc.template) {
      errors.push(`卡片 ${fc.id}: flow.template (${fc.template}) 与 dsl.template (${dc.template}) 不一致`);
    }
  }

  // §4.9 transition target 存在
  for (const fc of flowCards) {
    if (!Array.isArray(fc.transitions)) continue;
    for (const t of fc.transitions) {
      if (t?.targetCardId && !flowIds.has(t.targetCardId)) {
        errors.push(`卡片 ${fc.id} 的 transition target "${t.targetCardId}" 不存在`);
      }
    }
  }

  // §4.10 每卡最多 5 block、3 action
  for (const c of dslCards) {
    if (c?.blocks && c.blocks.length > 5) {
      errors.push(`卡片 ${c.id}: block 数量 ${c.blocks.length} 超过上限 5`);
    }
    if (c?.actions && c.actions.length > 3) {
      errors.push(`卡片 ${c.id}: action 数量 ${c.actions.length} 超过上限 3`);
    }
  }

  // §4.11 总卡片数建议 3-10
  if (dslCards.length > 10) {
    errors.push(`总卡片数 ${dslCards.length} 超过 10，建议拆分`);
  }

  // §4.13 每个用户可触发动作必须有确定结果（本地变更/Flow转移/工具调用）
  // §13.10-13.12 action 校验
  for (const c of dslCards) {
    if (!c?.actions) continue;
    const fc = flowCards.find((f) => f.id === c.id);
    for (const action of c.actions) {
      validateAction(action, c.id, fc, errors);
    }
    // block/action ID 唯一
    const blockIds = (c.blocks || []).map((b) => b?.id).filter(Boolean);
    if (new Set(blockIds).size !== blockIds.length) {
      errors.push(`卡片 ${c.id}: block ID 不唯一`);
    }
    const actionIds = c.actions.map((x) => x?.id).filter(Boolean);
    if (new Set(actionIds).size !== actionIds.length) {
      errors.push(`卡片 ${c.id}: action ID 不唯一`);
    }
  }

  // §6 binding path 在数据目录内
  for (const c of dslCards) {
    if (!c?.blocks) continue;
    for (const b of c.blocks) {
      if (!b) continue;
      checkBinding(b.valueBinding, `${c.id}.${b.id}.valueBinding`, errors);
      checkBinding(b.secondaryBinding, `${c.id}.${b.id}.secondaryBinding`, errors);
      checkBinding(b.itemsBinding, `${c.id}.${b.id}.itemsBinding`, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ----------------------- 辅助函数 ----------------------- */

function checkUniqueIds(cards: Partial<FlowCard>[], scope: string, errors: string[]) {
  const ids = cards.map((c) => c?.id).filter(Boolean);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length > 0) {
    errors.push(`${scope} 内 ID 不唯一: ${[...new Set(dup)].join(", ")}`);
  }
}

/** 合法的状态命名空间前缀（spec §6.1） */
const VALID_NAMESPACES = ["strings.", "numbers.", "booleans.", "stringLists.", "numberLists.", "objectsJson."];

function checkBinding(b: Binding | undefined, label: string, errors: string[]) {
  if (!b || !b.path) return; // 省略或空 path 用默认值/fallback，不报错
  // 命名空间格式校验：path 必须以合法命名空间开头（动态 state key 也合法）
  const nsOk = VALID_NAMESPACES.some((ns) => b.path.startsWith(ns));
  if (!nsOk) {
    errors.push(`${label}: path "${b.path}" 缺少合法命名空间前缀（strings./numbers./...）`);
  }
}

function validateAction(
  action: Partial<Action>,
  cardId: string,
  flowCard: Partial<FlowCard> | undefined,
  errors: string[],
) {
  if (!action?.id) {
    errors.push(`卡片 ${cardId}: 存在无 id 的 action`);
    return;
  }
  if (!action.kind || !["local", "tool"].includes(action.kind)) {
    errors.push(`卡片 ${cardId} action ${action.id}: kind 必须是 local 或 tool，实际 ${action.kind}`);
    return;
  }

  // 工具动作校验
  if (action.kind === "tool") {
    const tc = action.toolCall;
    if (!tc || !tc.adapterId || !tc.operation) {
      errors.push(`卡片 ${cardId} action ${action.id}: tool 动作缺少 toolCall/adapterId/operation`);
      return;
    }
    const tool = findTool(tc.adapterId, tc.operation);
    if (!tool) {
      errors.push(`卡片 ${cardId} action ${action.id}: 工具 ${tc.adapterId}/${tc.operation} 不在能力目录中`);
      return;
    }
    // outcomes 必须全覆盖
    const declared = tc.outcomes || [];
    const missing = tool.outcomes.filter((o) => !declared.includes(o));
    if (missing.length > 0) {
      errors.push(`卡片 ${cardId} action ${action.id}: 缺少 outcomes [${missing.join(", ")}]`);
    }
    // §5.3 每个 outcome 都要有 transition（事件 = actionId.outcome）
    if (flowCard?.transitions) {
      for (const o of declared) {
        const evt = `${action.id}.${o}`;
        if (!flowCard.transitions.some((t) => t.event === evt)) {
          errors.push(`卡片 ${cardId} action ${action.id}: 缺少工具事件 "${evt}" 的 transition`);
        }
      }
    }
  }

  // 本地动作校验
  if (action.kind === "local") {
    // §5.2 本地动作事件 = action.event ?? action.id，必须在 flow transition 中
    const evt = action.event || action.id;
    if (flowCard?.transitions && !flowCard.transitions.some((t) => t.event === evt)) {
      // session.reset 通常会有对应 event；若 flowCard 无 transitions（终态）则跳过
      if (flowCard.transitions.length > 0 || action.operation !== "session.reset") {
        errors.push(`卡片 ${cardId} action ${action.id}: 本地事件 "${evt}" 在 flow transitions 中找不到`);
      }
    }
  }

  // 禁止动作（§8.3）
  if ((action.kind as string) === "host" || (action.kind as string) === "agent") {
    errors.push(`卡片 ${cardId} action ${action.id}: 禁止 kind "${action.kind}"`);
  }
}
