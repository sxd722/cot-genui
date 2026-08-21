import { createParser, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import { describe, expect, it } from "vitest";
import type { CardPlan } from "../../src/dsl/modules";
import { collectAssetRequests } from "../../src/openui/assetResolver";
import type { AssetManifest } from "../../src/openui/assetTypes";
import { invalidAssetRefsInTree } from "../../src/openui/assetTypes";
import { detectDesignMetadataLeakage } from "../../src/openui/designLeakage";
import runtimeSpec from "../../src/openui/generated/system-prompt.spec.json";
import { containsRawExternalUrl } from "../../src/openui/localInteraction";
import { buildOpenUIGenerationPayload } from "../../src/openui/payload";
import { openUISystemPromptFor } from "../../src/openui/promptRouting";

const plan: CardPlan = {
  skillName: "商务酒店推荐",
  reasoning: "偏视觉叙事，优先让用户先看到结论。",
  cards: [{
    id: "hotel",
    purpose: "住宿推荐",
    presentation: { archetype: "media", density: "balanced", emphasis: "media" },
    blocks: [{
      kind: "summary",
      title: "海淀商务住宿",
      text: "优先选择地铁沿线、安静且支持灵活取消的酒店。",
      assetRequest: { kind: "image", query: "Beijing Haidian business hotel exterior", count: 1, role: "hero" },
    }],
    actions: [{ id: "details", label: "查看详情", type: "llm-call", role: "primary" }],
  }],
};

const manifest: AssetManifest = {
  requests: [{ id: "asset_hotel_1", cardId: "hotel", kind: "image", query: "Beijing Haidian business hotel exterior", count: 1, role: "hero" }],
  assets: [{ id: "asset_hotel_1", kind: "image", src: "https://cdn.example/hotel.jpg", alt: "酒店外观", provider: "fixture" }],
};

describe("media + design routing static end-to-end gate", () => {
  it("carries only renderable facts, safe IDs and actions into Step 6", () => {
    const requests = collectAssetRequests(plan);
    const payload = buildOpenUIGenerationPayload(plan, manifest);
    const serialized = JSON.stringify(payload);

    expect(requests).toHaveLength(1);
    expect(payload.designBrief.cards[0].renderableContent.facts).toContain("优先选择地铁沿线、安静且支持灵活取消的酒店。");
    expect(payload.designBrief.cards[0].availableAssets[0].id).toBe("asset_hotel_1");
    expect(payload.designBrief.cards[0].actions[0].actionRef).toBe("plan:hotel:details");
    expect(serialized).not.toContain("https://cdn.example/hotel.jpg");
    expect(serialized).not.toContain("偏视觉叙事");
    expect(serialized).not.toContain("优先让用户先看到结论");
  });

  it("keeps routed media capability and validates an assetRef-only artifact", () => {
    const payload = buildOpenUIGenerationPayload(plan, manifest);
    const routed = openUISystemPromptFor({ taskFamily: "recommendation", modelProfile: "groq_qwen_3_6_27b" });
    const code = `${payload.requiredShell}
card_0_body = Stack([image, copy, action], "column", "m")
image = AssetImage("asset_hotel_1", "酒店外观", "wide")
copy = TextContent("优先选择地铁沿线、安静且支持灵活取消的酒店。")
action = HostActionChip("查看详情", "plan:hotel:details")`;
    const parsed = createParser((runtimeSpec as LibrarySpec).schema as LibraryJSONSchema).parse(code);

    expect(routed.promptProfile).toBe("compact:recommendation");
    expect(routed.prompt).toContain("AssetImage");
    expect(parsed.meta.errors).toEqual([]);
    expect(parsed.meta.unresolved).toEqual([]);
    expect(invalidAssetRefsInTree(parsed.root, manifest)).toEqual([]);
    expect(containsRawExternalUrl(code)).toBe(false);
    expect(detectDesignMetadataLeakage({ openuiCode: code, cardPlan: plan, designBrief: payload.designBrief })).toEqual([]);
    expect(code.match(/plan:hotel:details/g)).toHaveLength(1);
  });

  it("retains raw-URL and design-metadata rejection boundaries", () => {
    const payload = buildOpenUIGenerationPayload(plan, manifest);

    expect(containsRawExternalUrl('image = AssetImage("https://example.com/hotel.jpg")')).toBe(true);
    expect(detectDesignMetadataLeakage({
      openuiCode: `${payload.requiredShell}\ncard_0_body = TextContent("感觉与节奏")`,
      cardPlan: plan,
      designBrief: payload.designBrief,
    })).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "schema_label" })]));
  });
});
