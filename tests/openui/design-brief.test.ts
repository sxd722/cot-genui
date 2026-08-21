import { describe, expect, it } from "vitest";
import { buildOpenUIDesignBrief } from "../../src/openui/designBrief";
import type { CardPlan } from "../../src/dsl/modules";
import { sampleCardPlan } from "./fixtures";

const plan: CardPlan = {
  ...sampleCardPlan,
  reasoning: "内部推理：先视觉后细节，优先让用户先看到结论",
  cards: [{
    id: "hotel",
    purpose: "住宿推荐",
    presentation: { archetype: "media", density: "balanced", emphasis: "media" },
    blocks: [
      { kind: "summary", title: "住宿建议", text: "优先选择海淀区、靠近地铁的酒店。" },
      { kind: "metric", metrics: [{ label: "均价", value: 520, unit: "元/晚" }] },
      { kind: "choice", options: ["大床房", "双床房"] },
    ],
    actions: [{ id: "open_map", label: "查看地图", type: "external-link", link: "https://example.com/map", role: "primary" }],
  }],
};

const emptyManifest = { requests: [], assets: [] };

describe("buildOpenUIDesignBrief", () => {
  it("keeps user-facing facts", () => {
    const brief = buildOpenUIDesignBrief(plan, emptyManifest);

    expect(JSON.stringify(brief)).toContain("优先选择海淀区");
    expect(brief.cards[0].renderableContent.facts).toEqual(
      expect.arrayContaining(["住宿建议", "优先选择海淀区、靠近地铁的酒店。"]),
    );
  });

  it("does not carry prose design guidance or internal reasoning", () => {
    const brief = buildOpenUIDesignBrief(plan, emptyManifest);
    const serialized = JSON.stringify(brief);

    expect(serialized).not.toContain("感觉与节奏");
    expect(serialized).not.toContain("整体创作方向");
    expect(serialized).not.toContain("表达意图");
    expect(serialized).not.toContain("可以重新组织信息层级");
    expect(serialized).not.toContain("优先让用户先看到结论");
    expect(serialized).not.toContain("偏视觉叙事");
    expect(serialized).not.toContain("Vibe brief");
    expect(serialized).not.toContain(plan.reasoning);
  });

  it("keeps design enums only inside designIntent", () => {
    const brief = buildOpenUIDesignBrief(plan, emptyManifest);

    expect(brief.cards[0].designIntent).toEqual({
      archetype: "media",
      density: "balanced",
      emphasis: "media",
    });
  });

  it("omits designIntent when the card declares no presentation", () => {
    const brief = buildOpenUIDesignBrief(
      { ...plan, cards: [{ ...plan.cards[0], presentation: undefined }] },
      emptyManifest,
    );

    expect(brief.cards[0].designIntent).toBeUndefined();
  });

  it("moves metrics and options into structured fields, not facts", () => {
    const brief = buildOpenUIDesignBrief(plan, emptyManifest);

    expect(brief.cards[0].renderableContent.metrics).toEqual([{ label: "均价", value: 520, unit: "元/晚" }]);
    expect(brief.cards[0].renderableContent.options).toEqual(["大床房", "双床房"]);
    expect(brief.cards[0].renderableContent.facts).not.toContain("均价");
  });

  it("converts actions to safe refs without exposing URLs", () => {
    const brief = buildOpenUIDesignBrief(plan, emptyManifest);

    expect(brief.cards[0].actions).toEqual([{
      actionRef: `plan:${encodeURIComponent("hotel")}:${encodeURIComponent("open_map")}`,
      label: "查看地图",
      type: "external-link",
      role: "primary",
    }]);
    expect(JSON.stringify(brief)).not.toContain("https://");
  });

  it("lists only the card's own assets from the manifest", () => {
    const brief = buildOpenUIDesignBrief(plan, {
      requests: [
        { id: "asset_hotel_1", cardId: "hotel", kind: "image", query: "hotel exterior", count: 1, role: "hero" },
        { id: "asset_other_1", cardId: "other", kind: "image", query: "other", count: 1, role: "hero" },
      ],
      assets: [
        { id: "asset_hotel_1", kind: "image", src: "https://cdn.example/hotel.jpg", alt: "酒店外观" },
        { id: "asset_other_1", kind: "image", src: "https://cdn.example/other.jpg", alt: "其他" },
      ],
    });

    expect(brief.cards[0].availableAssets).toEqual([
      { id: "asset_hotel_1", kind: "image", alt: "酒店外观", cardId: "hotel", role: "hero", requestId: "asset_hotel_1" },
    ]);
    expect(JSON.stringify(brief.cards[0].availableAssets)).not.toMatch(/https?:\/\/|provider|license/i);
  });

  it("scrubs any raw URL that leaks into fact text", () => {
    const brief = buildOpenUIDesignBrief({
      ...plan,
      cards: [{ ...plan.cards[0], blocks: [{ kind: "text", text: "详情见 https://example.com/info" }] }],
    }, emptyManifest);

    expect(brief.cards[0].renderableContent.facts[0]).toBe("详情见 [宿主外链]");
  });
});
