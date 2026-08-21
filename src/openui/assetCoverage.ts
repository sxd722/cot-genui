import type { ElementNode } from "@openuidev/lang-core";
import { assetRefsInTree, safeAssetRefs, type AssetManifest, type AssetRequest } from "./assetTypes";

export interface MissingAssetCoverage {
  requestId: string;
  cardId: string;
  role: AssetRequest["role"];
  aspect?: AssetRequest["aspect"];
  allowedAssetRefs: string[];
  requiredCount: number;
  matchedCount: number;
}

export interface OpenUIAssetCoverage {
  valid: boolean;
  required: number;
  matched: number;
  missing: MissingAssetCoverage[];
  errors: string[];
}

function isElementNode(value: unknown): value is ElementNode {
  return !!value && typeof value === "object" && (value as Partial<ElementNode>).type === "element";
}

/** Enforces accepted CardPlan media requests without making unresolved requests mandatory. */
export function validateAssetCoverage(root: ElementNode, manifest: AssetManifest): OpenUIAssetCoverage {
  const safeRefs = safeAssetRefs(manifest);
  const refsById = new Map(safeRefs.map((asset) => [asset.id, asset]));
  const generatedCards = (Array.isArray(root.props.children) ? root.props.children : [])
    .filter(isElementNode)
    .filter((node) => node.typeName === "GeneratedCard");
  const refsByCard = new Map<string, string[]>();
  const errors: string[] = [];

  for (const card of generatedCards) {
    const cardId = String(card.props.cardId ?? "");
    const refs = assetRefsInTree(card);
    refsByCard.set(cardId, refs);
    for (const ref of refs) {
      const safe = refsById.get(ref);
      if (safe && safe.cardId !== cardId) {
        errors.push(`assetRef ${ref} 属于卡片 ${safe.cardId}，不能在错误卡片 ${cardId} 中引用`);
      }
    }
  }

  const missing: MissingAssetCoverage[] = [];
  let required = 0;
  let matched = 0;
  for (const request of manifest.requests) {
    const allowedAssetRefs = safeRefs.filter((asset) => asset.requestId === request.id).map((asset) => asset.id);
    if (allowedAssetRefs.length === 0) continue;
    required += 1;
    const requiredCount = request.kind === "gallery" && allowedAssetRefs.length >= 2 ? 2 : 1;
    const cardRefs = new Set(refsByCard.get(request.cardId) ?? []);
    const matchedCount = allowedAssetRefs.filter((id) => cardRefs.has(id)).length;
    if (matchedCount >= requiredCount) {
      matched += 1;
      continue;
    }
    missing.push({
      requestId: request.id,
      cardId: request.cardId,
      role: request.role,
      ...(request.aspect ? { aspect: request.aspect } : {}),
      allowedAssetRefs,
      requiredCount,
      matchedCount,
    });
  }

  if (missing.length) {
    errors.push(`缺少已解析 CardPlan 图片请求: ${missing.map((item) => `${item.requestId}(${item.matchedCount}/${item.requiredCount})`).join(", ")}`);
  }
  return { valid: errors.length === 0, required, matched, missing, errors };
}
