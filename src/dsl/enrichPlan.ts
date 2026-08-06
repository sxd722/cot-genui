/**
 * CardPlan 信息补齐器
 *
 * 扫描 cardPlan 中所有 block 的 missingInfo，逐个补齐：
 * - web_search → /api/search（外部客观信息：股价/天气/利率等）
 * - llm_reasoning → /api/llm（推理生成：行动清单/对比分析等）
 *
 * 补齐后更新 block 的 value/items 字段。
 * 返回 enriched cardPlan + 补齐日志。
 */

import type { CardPlan, IRBlock, IRMissingInfo, CompileNotice } from "./modules";

/** 单条补齐结果 */
export interface EnrichResult {
  cardId: string;
  blockTitle: string;
  source: string;
  query: string;
  success: boolean;
  result?: string;
  error?: string;
}

/** 补齐进度回调 */
export type EnrichProgress = (done: number, total: number, current: string) => void;

/**
 * 扫描 cardPlan，补齐所有 missingInfo block。
 * 返回 { enrichedPlan, results, notices }。
 */
export async function enrichCardPlan(
  plan: CardPlan,
  onProgress?: EnrichProgress,
): Promise<{
  enrichedPlan: CardPlan;
  results: EnrichResult[];
  notices: CompileNotice[];
}> {
  // 深拷贝（不修改原 plan）
  const enriched: CardPlan = JSON.parse(JSON.stringify(plan));
  const results: EnrichResult[] = [];
  const notices: CompileNotice[] = [];

  // 收集所有需要补齐的 block
  const tasks: { cardId: string; block: IRBlock; missing: IRMissingInfo }[] = [];
  for (const card of enriched.cards) {
    for (const block of card.blocks ?? []) {
      if (block.missingInfo) {
        tasks.push({ cardId: card.id, block, missing: block.missingInfo });
      }
    }
  }

  const total = tasks.length;
  if (total === 0) {
    return { enrichedPlan: enriched, results: [], notices: [] };
  }

  // 逐个补齐
  for (let i = 0; i < tasks.length; i++) {
    const { cardId, block, missing } = tasks[i];
    const title = block.title ?? block.kind;
    onProgress?.(i, total, title);

    const result = await enrichBlock(block, missing);
    results.push({
      cardId,
      blockTitle: title,
      source: missing.source,
      query: missing.query,
      success: result.success,
      result: result.text,
      error: result.error,
    });

    if (result.success && result.text) {
      // 补齐成功：写入 block 内容
      // list 类型 → items；其他 → value
      if (block.kind === "list") {
        const lines = result.text
          .split("\n")
          .map((l) => l.replace(/^[\d•\-\*]\s*/, "").trim())
          .filter((l) => l.length > 0);
        block.items = lines.map((label) => ({ label }));
      } else {
        block.value = result.text;
      }
      // 补齐后清除 missingInfo 标记
      block.missingInfo = undefined;
    } else {
      // 补齐失败：保留 fallback 文本
      if (missing.fallback) {
        block.value = missing.fallback;
      }
      notices.push({
        level: "info",
        message: `missingInfo 补齐失败(${missing.source}): ${result.error}`,
        location: `${cardId}.${title}`,
      });
    }
  }

  onProgress?.(total, total, "完成");
  return { enrichedPlan: enriched, results, notices };
}

/* ------------------------------------------------------------------ */
/*  单个 block 补齐                                                     */
/* ------------------------------------------------------------------ */

async function enrichBlock(
  block: IRBlock,
  missing: IRMissingInfo,
): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const endpoint = missing.source === "web_search" ? "/api/search" : "/api/llm";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: missing.query, query: missing.query }),
    });
    if (!res.ok) {
      return { success: false, error: `${endpoint} 返回 ${res.status}` };
    }
    const data = await res.json();
    const text = data.text ?? data.result ?? "";
    if (!text) {
      return { success: false, error: "返回空内容" };
    }
    return { success: true, text };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 检查 cardPlan 是否有 missingInfo（用于判断是否需要补齐） */
export function hasMissingInfo(plan: CardPlan): boolean {
  return plan.cards.some((c) =>
    (c.blocks ?? []).some((b) => b.missingInfo),
  );
}
