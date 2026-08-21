import type { CardPlan } from "../src/dsl/modules";
import { resolveAssetManifest } from "../src/openui/assetResolver";

const plan: CardPlan = {
  skillName: "OpenUI asset smoke",
  reasoning: "Verify the host-owned image path.",
  cards: [{
    id: "smoke",
    purpose: "媒体链路验证",
    blocks: [{
      kind: "image",
      title: "Tokyo skyline",
      assetRequest: { kind: "image", query: "Tokyo skyline travel", count: 1, role: "hero" },
    }],
  }],
};

async function main(): Promise<void> {
  const hasCustomProvider = !!process.env.IMAGE_SEARCH_API_URL && !!process.env.IMAGE_SEARCH_API_KEY;
  const hasPexelsProvider = !!process.env.PEXELS_API_KEY;
  if (!hasCustomProvider && !hasPexelsProvider) {
    console.log("OpenUI asset smoke skipped: configure PEXELS_API_KEY or IMAGE_SEARCH_API_URL + IMAGE_SEARCH_API_KEY in .env.local.");
    return;
  }

  const result = await resolveAssetManifest(plan, { env: process.env });
  const firstAsset = result.manifest.assets[0];
  if (!firstAsset) {
    console.error(JSON.stringify({
      providerState: result.diagnostics.providerState,
      providerKind: result.diagnostics.providerKind,
      requests: result.diagnostics.requests,
      candidates: result.diagnostics.candidates,
      accepted: result.diagnostics.accepted,
      rejected: result.diagnostics.rejected,
      events: result.diagnostics.events,
    }, null, 2));
    throw new Error("Configured image provider did not produce a validated public asset.");
  }

  console.log(JSON.stringify({
    providerState: result.diagnostics.providerState,
    providerKind: result.diagnostics.providerKind,
    requests: result.diagnostics.requests,
    candidates: result.diagnostics.candidates,
    accepted: result.diagnostics.accepted,
    rejected: result.diagnostics.rejected,
    firstAsset: { id: firstAsset.id, alt: firstAsset.alt },
  }, null, 2));
}

void main();
