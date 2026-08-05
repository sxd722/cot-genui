/**
 * Flow 状态机 reducer（spec §5）
 *
 * 纯函数：输入 (当前 card 的 transitions, 事件) → 目标 cardId。
 * 不持有状态、无副作用。处理两类事件：
 *   - 本地动作事件：action.event ?? action.id
 *   - 工具结果事件：actionId.outcome
 */

import type { FlowTransition, CardArtifact } from "./types";

/**
 * 根据 flow 和事件，找出当前卡片应该跳转到的目标 cardId。
 * 找不到匹配的 transition 时返回 null（表示留在当前卡，或流程异常）。
 */
export function resolveTransition(
  transitions: FlowTransition[],
  event: string,
): string | null {
  const t = transitions.find((tr) => tr.event === event);
  return t ? t.targetCardId : null;
}

/**
 * 从 artifact 中取指定 flow card 的 transitions。
 */
export function getFlowCardTransitions(
  artifact: CardArtifact,
  cardId: string,
): FlowTransition[] {
  const fc = artifact.flow.cards.find((c) => c.id === cardId);
  return fc?.transitions ?? [];
}

/**
 * 计算一个本地 action 触发的事件名（spec §5.2）。
 * action.event 非空 ? action.event : action.id
 */
export function localActionEvent(action: {
  event?: string;
  id: string;
}): string {
  return action.event || action.id;
}

/**
 * 计算工具 action 某个 outcome 对应的事件名（spec §5.3）。
 * 格式：actionId.outcome
 */
export function toolActionEvent(actionId: string, outcome: string): string {
  return `${actionId}.${outcome}`;
}

/**
 * 从 startCardId 出发做可达性检查（spec §4.12）。
 * 返回从起始卡可达的所有 cardId 集合（用于校验是否有孤岛卡片）。
 */
export function reachableCards(artifact: CardArtifact): Set<string> {
  const visited = new Set<string>();
  const queue = [artifact.flow.startCardId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const transitions = getFlowCardTransitions(artifact, id);
    for (const t of transitions) {
      if (!visited.has(t.targetCardId)) queue.push(t.targetCardId);
    }
  }
  return visited;
}
