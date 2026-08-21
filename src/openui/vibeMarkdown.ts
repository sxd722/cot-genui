import type { CardNode, CardPlan, IRBlock } from "@/dsl/modules";
import { assetRequestId, safeAssetRefs, type AssetManifest, type AssetResolutionDiagnostics } from "./assetTypes";
import { conciseCardTitle } from "./cardTitle";

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s<>()\]]+/gi, "[宿主外链]")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function blockFacts(block: IRBlock): string[] {
  const facts = [block.value, block.text, block.detail]
    .map(clean)
    .filter(Boolean);
  for (const item of block.items ?? []) {
    facts.push([clean(item.label), clean(item.detail)].filter(Boolean).join(" — "));
  }
  for (const metric of block.metrics ?? []) {
    facts.push(`${clean(metric.label)}：${metric.value}${clean(metric.unit)}`);
  }
  if (block.options?.length) facts.push(`可选项：${block.options.map(clean).join(" / ")}`);
  return [...new Set(facts)];
}

function cardVibe(card: CardNode): string {
  const kinds = new Set(card.blocks.map((block) => block.kind));
  if (kinds.has("chart") || kinds.has("metric") || kinds.has("progress")) return "数据感清晰、重点数字有呼吸感，避免做成密集报表。";
  if (kinds.has("choice") || kinds.has("toggle")) return "像一个轻量决策面板，选项清楚、反馈直接、操作区域有触感。";
  if (kinds.has("image") || kinds.has("infographic")) return "偏视觉叙事，先建立氛围，再用短句和局部信息完成解释。";
  if (kinds.has("list")) return "扫描友好、节奏分明，让每一项都像经过编辑的推荐而不是数据库行。";
  return "克制但有个性，强调一眼能懂的主结论和自然的阅读节奏。";
}

/**
 * High-tolerance creative brief for the OpenUI model. It intentionally avoids
 * YAML and positional UI instructions: facts/actions stay explicit while the
 * visual composition remains open-ended.
 */
export function cardPlanToVibeMarkdown(plan: CardPlan, assetManifest?: AssetManifest, diagnostics?: AssetResolutionDiagnostics): string {
  const availableAssets = assetManifest ? safeAssetRefs(assetManifest) : [];
  const experienceDirection = plan.cards.length === 1
    ? "这是一个 **单卡体验**。让这一张卡直接、完整地解决用户意图，不要暗示还需要额外卡片。"
    : `这是一个由 **${plan.cards.length} 张平级卡片**组成的体验。每张卡应有独立目标和清晰焦点，但整组仍像同一套作品。`;
  const lines = [
    `# ${plan.iconText ? `${clean(plan.iconText)} ` : ""}${clean(plan.skillName)}`,
    "",
    `> **Vibe brief** — ${clean(plan.reasoning)}`,
    "",
    "## 整体创作方向",
    "",
    experienceDirection,
    "内容事实和动作语义必须保留；版式、层级、图表、标签、折叠、对比方式与留白可以自由发挥。",
  ];

  plan.cards.forEach((card, cardIndex) => {
    lines.push(
      "",
      `## 卡片 ${cardIndex + 1} / ${plan.cards.length} · ${conciseCardTitle(card.title ?? card.purpose, `卡片 ${cardIndex + 1}`)}`,
      "",
      `> **Card ID:** \`${clean(card.id)}\``,
      "",
      "### 感觉与节奏",
      "",
      `主题：${clean(card.purpose)}`,
      "",
      cardVibe(card),
      "可以重新组织信息层级，不必机械复刻下面的 block 顺序；优先让用户先看到结论，再看到依据和下一步。",
    );

    if (card.presentation) {
      lines.push(
        "",
        "### 表达意图",
        "",
        `- archetype: ${card.presentation.archetype}`,
        ...(card.presentation.density ? [`- density: ${card.presentation.density}`] : []),
        ...(card.presentation.emphasis ? [`- emphasis: ${card.presentation.emphasis}`] : []),
      );
    }

    const cardRequests = card.blocks.flatMap((block, blockIndex) => block.assetRequest ? [{
      id: assetRequestId(card.id, blockIndex),
      ...block.assetRequest,
    }] : []);
    if (cardRequests.length) {
      lines.push("", "### 图片资产", "");
      for (const request of cardRequests) {
        const accepted = availableAssets.filter((asset) => asset.requestId === request.id);
        const failure = diagnostics?.events.find((event) => event.requestId === request.id);
        const status = !assetManifest
          ? "待宿主解析"
          : accepted.length
            ? `已解析为 ${accepted.map((asset) => `\`${asset.id}\``).join("、")}`
            : failure
              ? `未解析（${clean(failure.stage)}：${clean(failure.reason)}）`
              : `未解析（${clean(diagnostics?.providerState ?? "无可用候选")}）`;
        lines.push(
          `- \`${request.id}\``,
          `  - 主题：${clean(request.query)}`,
          `  - 用途：${request.role}`,
          `  - 画幅：${request.aspect ?? (request.role === "hero" ? "wide" : request.role === "gallery" ? "square" : "wide")}`,
          `  - 数量：${request.count}`,
          `  - 状态：${status}`,
        );
      }
    }

    lines.push("", "### 数据", "");

    if (!card.blocks.length) {
      lines.push("- 无额外结构化数据；围绕本卡用途进行简洁表达。");
    } else {
      const seenData = new Set<string>();
      card.blocks.forEach((block, blockIndex) => {
        const rawTitle = clean(block.title);
        const title = rawTitle && !seenData.has(rawTitle) ? rawTitle : `内容 ${blockIndex + 1}`;
        if (rawTitle) seenData.add(rawTitle);
        const facts = blockFacts(block).filter((fact) => {
          if (seenData.has(fact)) return false;
          seenData.add(fact);
          return true;
        });
        lines.push(`- **${title}** · ${block.kind}${block.tone ? ` · ${clean(block.tone)}` : ""}`);
        if (facts.length) facts.forEach((fact) => lines.push(`  - ${fact}`));
      });
    }

    lines.push("", "### 动作", "");
    const actions = card.actions ?? [];
    if (!actions.length) {
      lines.push("- 无宿主动作；本卡保持纯展示。");
    } else {
      actions.forEach((action) => {
        const actionRef = `plan:${encodeURIComponent(card.id)}:${encodeURIComponent(action.id)}`;
        lines.push(`- \`${actionRef}\` — **${clean(action.label)}**（${action.type}${action.role ? ` / ${action.role}` : ""}）`);
      });
    }
  });

  return lines.join("\n");
}
