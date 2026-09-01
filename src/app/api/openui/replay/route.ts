import { NextResponse } from "next/server";
import type { CardPlan } from "@/dsl/modules";
import { validateOpenUIArtifact } from "@/lib/openui";
import { resolveAssetManifest } from "@/openui/assetResolver";
import type { AssetManifest, AssetResolutionDiagnostics } from "@/openui/assetTypes";

function isAssetManifest(value: unknown): value is AssetManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<AssetManifest>;
  return Array.isArray(manifest.requests) && Array.isArray(manifest.assets)
    && manifest.requests.every((item) => item && typeof item.id === "string" && typeof item.cardId === "string")
    && manifest.assets.every((item) => item && typeof item.id === "string" && typeof item.src === "string" && /^https:\/\//i.test(item.src));
}

export async function POST(request: Request) {
  let body: { cardPlan?: CardPlan; openuiCode?: string; assetManifest?: AssetManifest; preferSnapshotAssets?: boolean };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!body.cardPlan || !Array.isArray(body.cardPlan.cards) || typeof body.openuiCode !== "string") {
    return NextResponse.json({ error: "缺少 CardPlan 或 OpenUI 源码" }, { status: 400 });
  }
  try {
    const snapshotManifest = isAssetManifest(body.assetManifest) ? body.assetManifest : undefined;
    const useSnapshotManifest = body.preferSnapshotAssets === true && snapshotManifest;
    const resolution = useSnapshotManifest
      ? {
          manifest: snapshotManifest,
          diagnostics: {
            providerState: "ready", providerKind: "snapshot-cache", providersTried: ["snapshot-cache"],
            requests: snapshotManifest.requests.length, candidates: snapshotManifest.assets.length,
            accepted: snapshotManifest.assets.length, rejected: 0, events: [],
          } satisfies AssetResolutionDiagnostics,
        }
      : body.cardPlan.cards.some((card) => card.blocks.some((block) => !!block.assetRequest))
        ? await resolveAssetManifest(body.cardPlan)
        : { manifest: { requests: [], assets: [] }, diagnostics: undefined };
    const validation = validateOpenUIArtifact(body.openuiCode, body.cardPlan, resolution.manifest);
    if (!validation.valid) {
      return NextResponse.json({ valid: false, errors: validation.errors, validation }, { status: 409 });
    }
    return NextResponse.json({
      valid: true, validation, assetManifest: resolution.manifest,
      assetResolutionDiagnostics: resolution.diagnostics,
      assetSource: useSnapshotManifest ? "snapshot-cache" : "resolved",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "快照校验失败" }, { status: 500 });
  }
}
