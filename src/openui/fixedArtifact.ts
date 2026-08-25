import type { CardNode, CardPlan, IRBlock } from "../dsl/modules";
import { openUIActionRef } from "./actionRefs";
import { safeAssetRefs, type AssetManifest } from "./assetTypes";
import { buildOpenUIBootstrap } from "./bootstrap";
import { cardPlanLayoutMode } from "./layoutPolicy";

function statementValue(value: unknown) { return JSON.stringify(value); }

function textParts(block: IRBlock): string[] {
  const direct = [block.title, block.text, block.detail, block.value].filter((value): value is string => typeof value === "string" && !!value.trim());
  const items = (block.items ?? []).map((item) => [item.label, item.detail].filter(Boolean).join(" — "));
  const metrics = (block.metrics ?? []).map((metric) => `${metric.label}：${metric.value}${metric.unit ?? ""}`);
  return [...direct, ...items, ...metrics, ...(block.options ?? [])];
}

function cardFacts(card: CardNode): string[] {
  return card.blocks.flatMap(textParts).filter(Boolean);
}

function fixedContentStatements(card: CardNode, index: number, manifest?: AssetManifest): { refs: string[]; lines: string[] } {
  const prefix = `card_${index}_fixed`;
  const lines: string[] = [];
  const refs: string[] = [];
  const assets = manifest ? safeAssetRefs(manifest).filter((asset) => asset.cardId === card.id) : [];
  const facts = cardFacts(card);
  if (assets.length >= 2) {
    const ref = `${prefix}_gallery`;
    lines.push(`${ref} = FixedGallery(${statementValue(assets.slice(0, 2).map((asset) => asset.id))})`);
    refs.push(ref);
  } else if (assets.length === 1) {
    const ref = `${prefix}_media`;
    lines.push(`${ref} = FixedMedia(${statementValue(card.title ?? card.purpose)}, "", ${statementValue(assets[0].id)})`);
    refs.push(ref);
  }
  let consumedFacts = 0;
  for (let offset = 0; offset < facts.length && refs.length < 2; offset += 4) {
    const chunk = facts.slice(offset, offset + 4);
    if (!chunk.length) break;
    if (chunk.some((fact) => [...fact].length > 180)) throw new Error(`固定卡片 ${card.id} 含超过 180 字的语义原子，CardPlan 应先拆分文本`);
    const ref = `${prefix}_facts_${offset / 4 + 1}`;
    lines.push(`${ref} = FixedFacts(${statementValue(chunk)})`);
    refs.push(ref);
    consumedFacts += chunk.length;
  }
  if (consumedFacts < facts.length) throw new Error(`固定卡片 ${card.id} 的确定性布局容量不足，CardPlan 应先拆卡`);
  if (!refs.length) {
    const ref = `${prefix}_facts_1`;
    lines.push(`${ref} = FixedFacts(${statementValue([card.purpose])})`);
    refs.push(ref);
  }
  return { refs, lines };
}

export function buildDeterministicFixedOpenUI(cardPlan: CardPlan, manifest?: AssetManifest): string {
  if (cardPlanLayoutMode(cardPlan) !== "fixed-600x300") throw new Error("确定性固定布局只接受 fixed-600x300 CardPlan");
  const bootstrap = buildOpenUIBootstrap(cardPlan);
  const lines = [bootstrap.code];
  cardPlan.cards.forEach((card, index) => {
    if ((card.actions?.length ?? 0) > 2) throw new Error(`固定卡片 ${card.id} 的动作超过 2 个，CardPlan 应先拆卡`);
    const content = fixedContentStatements(card, index, manifest);
    lines.push(...content.lines);
    const actionRefs = (card.actions ?? []).map((action, actionIndex) => {
      const ref = `card_${index}_fixed_action_${actionIndex + 1}`;
      lines.push(`${ref} = HostActionChip(${statementValue(action.label)}, ${statementValue(openUIActionRef(card.id, action.id))})`);
      return ref;
    });
    const actionsRef = actionRefs.length ? `card_${index}_fixed_actions` : undefined;
    if (actionsRef) lines.push(`${actionsRef} = FixedActions([${actionRefs.join(", ")}])`);
    lines.push(`${bootstrap.bodyRefs[index].bodyRef} = FixedCardContent([${content.refs.join(", ")}]${actionsRef ? `, ${actionsRef}` : ""})`);
  });
  return lines.join("\n");
}
