import type { CardNode, CardPlan, IRBlock } from "../dsl/modules";
import type { InferenceState } from "./pipelineTypes";

interface WebResource {
  query: string;
  summary: string;
  url: string;
  score: number;
  actionKind: "order" | "reserve" | "details";
}

interface PendingResource extends WebResource {
  needsContent: boolean;
  needsLink: boolean;
  targetIndex: number;
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function sourceScore(value: string): number {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    let score = url.pathname !== "/" || !!url.search ? 5 : 0;
    if (host.endsWith(".gov.cn") || host === "gov.cn") score += 5;
    if (host.endsWith("dpm.org.cn")) score += 8;
    if (/book|ticket|reserve|booking|预约|购票/i.test(`${url.pathname}${url.search}`)) score += 4;
    return score;
  } catch {
    return -1;
  }
}

function webResources(state: InferenceState): WebResource[] {
  return (state.webFacts ?? []).slice(0, 6).flatMap((fact, index) => {
    const entities = (fact.entities ?? []).flatMap((entity) => {
      const url = validHttpUrl(entity.actionUrl) ?? validHttpUrl(entity.sourceUrl);
      return entity.name && url ? [{
        query: entity.name,
        summary: entity.description,
        url,
        score: sourceScore(url) + (entity.actionUrl ? 6 : 0),
        actionKind: entity.actionUrl ? entity.actionKind : "details" as const,
      }] : [];
    });
    if (entities.length) return entities;
    const candidates = [...new Set((fact.sources ?? []).map(validHttpUrl).filter((url): url is string => !!url))]
      .map((url, sourceIndex) => ({ url, score: sourceScore(url), sourceIndex }))
      .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex);
    if (!candidates[0]?.url) return [];
    return [{
      query: String(fact.query || `公开信息 ${index + 1}`),
      summary: String(fact.summary || "已取得公开来源，详情请查看原始页面。"),
      url: candidates[0].url,
      score: candidates[0].score,
      actionKind: "details" as const,
    }];
  });
}

function cardSearchText(card: CardNode): string {
  return JSON.stringify({ purpose: card.purpose, blocks: card.blocks }).toLowerCase();
}

function relevance(card: CardNode, resource: WebResource): number {
  const text = cardSearchText(card);
  const query = resource.query.toLowerCase().trim();
  let score = query && text.includes(query) ? 40 : 0;
  const terms = `${resource.query} ${resource.summary}`
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2);
  score += terms.filter((term) => text.includes(term)).length * 3;
  if (card.sourceSlots?.includes("webFacts")) score += 8;
  if (card.blocks.some((block) => block.kind === "list")) score += 4;
  if (/推荐|详情|选择|比较|方案|餐厅|酒店|景点/.test(card.purpose)) score += 3;
  if (/下一步|总结|收尾/.test(card.purpose)) score -= 4;
  score += Math.max(0, 5 - card.blocks.length) * 0.25;
  return score;
}

function bestTargetIndex(cards: CardNode[], resource: WebResource): number {
  return cards.reduce((best, card, index) => {
    const score = relevance(card, resource);
    return score > best.score ? { index, score } : best;
  }, { index: 0, score: Number.NEGATIVE_INFINITY }).index;
}

function compactResourceLabel(query: string, actionKind: WebResource["actionKind"]): string {
  const label = query.replace(/[\r\n]+/g, " ").trim();
  const verb = actionKind === "order" ? "去下单" : actionKind === "reserve" ? "去预订" : "查看";
  return `${verb}${label.slice(0, 18) || "公开来源"}`;
}

function appendContent(card: CardNode, resources: PendingResource[]) {
  const items = resources
    .filter((resource) => resource.needsContent)
    .map((resource) => ({ label: resource.query, detail: resource.summary }));
  if (!items.length) return;

  const existingList = card.blocks.find((block) =>
    block.kind === "list" && (block.sourceSlots?.includes("webFacts") || /公开|来源|补充/.test(block.title ?? "")));
  if (existingList) {
    const labels = new Set((existingList.items ?? []).map((item) => `${item.label}\u0000${item.detail ?? ""}`));
    existingList.items = [...(existingList.items ?? []), ...items.filter((item) => !labels.has(`${item.label}\u0000${item.detail ?? ""}`))];
    existingList.sourceSlots = [...new Set([...(existingList.sourceSlots ?? []), "webFacts"])];
    return;
  }

  if (card.blocks.length < 5) {
    card.blocks.push({ kind: "list", title: "补充信息", items, sourceSlots: ["webFacts"] });
    return;
  }

  const fallback = card.blocks.findLast((block) => block.kind === "summary" || block.kind === "text") ?? card.blocks.at(-1);
  if (!fallback) return;
  const supplement = items.map((item) => `${item.label}：${item.detail}`).join("；");
  fallback.detail = [fallback.detail, supplement].filter(Boolean).join("；");
  fallback.sourceSlots = [...new Set([...(fallback.sourceSlots ?? []), "webFacts"])];
}

/**
 * Merge uncovered public facts and safe links into the most relevant business
 * cards. Source completeness must never consume an extra user-facing card.
 */
export function integrateWebFactsIntoCardPlan(plan: CardPlan, state: InferenceState): CardPlan {
  if (!plan.cards.length) return plan;
  const cards = plan.cards.map((card) => ({
    ...card,
    sourceSlots: card.sourceSlots ? [...card.sourceSlots] : undefined,
    blocks: card.blocks.map((block): IRBlock => ({
      ...block,
      sourceSlots: block.sourceSlots ? [...block.sourceSlots] : undefined,
      items: block.items ? block.items.map((item) => ({ ...item })) : undefined,
    })),
    actions: card.actions ? card.actions.map((action) => ({ ...action })) : undefined,
  }));
  const existingText = JSON.stringify(cards.flatMap((card) => card.blocks));
  const existingLinks = new Set(
    cards.flatMap((card) => card.actions ?? [])
      .filter((action) => action.type === "external-link")
      .map((action) => validHttpUrl(action.link))
      .filter((url): url is string => !!url),
  );
  const pending = webResources(state).map((resource): PendingResource => ({
    ...resource,
    needsContent: !existingText.includes(resource.summary),
    needsLink: !existingLinks.has(resource.url),
    targetIndex: bestTargetIndex(cards, resource),
  })).filter((resource) => resource.needsContent || resource.needsLink);
  if (!pending.length) return plan;

  const groups = new Map<number, PendingResource[]>();
  for (const resource of pending) {
    groups.set(resource.targetIndex, [...(groups.get(resource.targetIndex) ?? []), resource]);
  }
  for (const [targetIndex, resources] of groups) {
    const target = cards[targetIndex];
    target.sourceSlots = [...new Set([...(target.sourceSlots ?? []), "webFacts"])];
    appendContent(target, resources);
  }

  const usedActionIds = new Set(cards.flatMap((card) => card.actions ?? []).map((action) => action.id));
  const linkResources = pending
    .filter((resource) => resource.needsLink)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  linkResources.forEach((resource, index) => {
    const target = cards[resource.targetIndex];
    if ((target.actions?.length ?? 0) >= 5) return;
    let actionId = `open_web_source_${index + 1}`;
    let suffix = 2;
    while (usedActionIds.has(actionId)) actionId = `open_web_source_${index + 1}_${suffix++}`;
    usedActionIds.add(actionId);
    target.actions = [...(target.actions ?? []), {
      id: actionId,
      label: compactResourceLabel(resource.query, resource.actionKind),
      type: "external-link",
      link: resource.url,
      role: target.actions?.length ? "secondary" : "primary",
    }];
  });

  return { ...plan, cards };
}
