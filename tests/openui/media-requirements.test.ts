import { describe, expect, it } from "vitest";
import { createParser, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import type { CardPlan } from "../../src/dsl/modules";
import { validateAssetCoverage } from "../../src/openui/assetCoverage";
import { ensureAssetRequests } from "../../src/openui/mediaPlanning";
import { buildOpenUIGenerationPayload, buildOpenUIRepairPayload } from "../../src/openui/payload";
import type { AssetManifest } from "../../src/openui/assetTypes";
import { cardPlanToVibeMarkdown } from "../../src/openui/vibeMarkdown";
import librarySpec from "../../src/openui/generated/system-prompt.spec.json";

const parser = createParser((librarySpec as LibrarySpec).schema as LibraryJSONSchema);

function assetCoverage(code: string, manifest: AssetManifest) {
  const parsed = parser.parse(code);
  if (!parsed.root) throw new Error("fixture did not parse");
  return validateAssetCoverage(parsed.root, manifest);
}

const banyanTreePlan: CardPlan = {
  skillName: "TravelPlanning",
  reasoning: "展示国内悦榕庄与图片",
  cards: [
    {
      id: "card_list",
      title: "国内悦榕庄",
      purpose: "展示国内悦榕庄酒店列表，帮助用户筛选目的地。",
      blocks: [{ kind: "list", items: [
        { label: "杭州西溪悦榕庄", detail: "杭州 | 湿地别墅" },
        { label: "丽江悦榕庄", detail: "丽江 | 纳西庭院" },
      ] }],
    },
    {
      id: "card_detail",
      title: "目的地详情",
      purpose: "展示杭州西溪悦榕庄或丽江悦榕庄的环境图片及亲子特色，辅助用户做出最终选择。",
      presentation: { archetype: "media", density: "immersive", emphasis: "media" },
      blocks: [
        { kind: "hero", text: "杭州西溪悦榕庄：位于西溪湿地，别墅带泳池，适合3岁儿童游玩。" },
        { kind: "summary", text: "丽江悦榕庄：束河古镇内的纳西庭院，体验传统文化，环境幽静。" },
      ],
    },
  ],
};

describe("CardPlan-driven media requirements", () => {
  it("deterministically synthesizes two visual requests for the Banyan Tree media card", () => {
    const result = ensureAssetRequests(banyanTreePlan, "国内有哪些悦榕庄？请提供图片");
    const detail = result.plan.cards[1];

    expect(result.diagnostics).toMatchObject({ modelDeclared: 0, synthesized: 2 });
    expect(detail.blocks[0].assetRequest).toMatchObject({
      kind: "image",
      query: expect.stringContaining("杭州西溪悦榕庄"),
      role: "hero",
      aspect: "wide",
      count: 1,
    });
    expect(detail.blocks[1].assetRequest).toMatchObject({
      kind: "image",
      query: expect.stringContaining("丽江悦榕庄"),
      role: "supporting",
      aspect: "wide",
      count: 1,
    });
    expect(result.plan.cards[0].blocks[0].assetRequest).toBeUndefined();
  });

  it("preserves model declarations, avoids pure data tasks, and caps synthesis at two", () => {
    const declared: CardPlan = {
      ...banyanTreePlan,
      cards: [{
        ...banyanTreePlan.cards[1],
        blocks: banyanTreePlan.cards[1].blocks.map((block, index) => index === 0
          ? { ...block, assetRequest: { kind: "image", query: "模型查询", count: 1, role: "hero", aspect: "portrait" } }
          : block),
      }],
    };
    const preserved = ensureAssetRequests(declared, "请提供图片");
    expect(preserved.plan.cards[0].blocks[0].assetRequest).toMatchObject({ query: "模型查询", aspect: "portrait" });
    expect(preserved.diagnostics).toMatchObject({ modelDeclared: 1, synthesized: 1 });

    const dataOnly: CardPlan = {
      skillName: "预算分析",
      reasoning: "比较数字",
      cards: [{ id: "metrics", purpose: "分析预算差异和同比变化", presentation: { archetype: "data", emphasis: "data" }, blocks: [
        { kind: "metric", metrics: [{ label: "预算", value: 100, unit: "元" }] },
        { kind: "chart", text: "同比变化趋势" },
      ] }],
    };
    expect(ensureAssetRequests(dataOnly, "分析预算").diagnostics.synthesized).toBe(0);

    const manyBlocks: CardPlan = {
      ...banyanTreePlan,
      cards: [{ ...banyanTreePlan.cards[1], blocks: [
        ...banyanTreePlan.cards[1].blocks,
        { kind: "summary", text: "三亚悦榕庄海滨泳池实景" },
      ] }],
    };
    expect(ensureAssetRequests(manyBlocks, "请展示酒店图片").diagnostics.synthesized).toBe(2);
  });

  it("projects pending and resolved image declarations without leaking URLs", () => {
    const { plan } = ensureAssetRequests(banyanTreePlan, "请提供图片");
    const requests = plan.cards[1].blocks.flatMap((block, index) => block.assetRequest ? [{
      id: `asset_card_detail_${index + 1}`,
      cardId: "card_detail",
      ...block.assetRequest,
    }] : []);
    const pending = cardPlanToVibeMarkdown(plan);
    expect(pending).toContain("### 图片资产");
    expect(pending).toContain("状态：待宿主解析");
    expect(pending).toContain("画幅：wide");

    const manifest: AssetManifest = {
      requests,
      assets: [{ id: requests[0].id, kind: "image", src: "https://cdn.example/hangzhou.jpg", alt: "杭州实景" }],
    };
    const resolved = cardPlanToVibeMarkdown(plan, manifest);
    expect(resolved).toContain(`状态：已解析为 \`${requests[0].id}\``);
    expect(resolved).toContain("状态：未解析");
    expect(resolved).not.toContain("https://cdn.example");
  });

  it("keeps safe model payload ID-only while carrying request identity and aspect", () => {
    const { plan } = ensureAssetRequests(banyanTreePlan, "请提供图片");
    const request = { id: "asset_card_detail_1", cardId: "card_detail", ...plan.cards[1].blocks[0].assetRequest! };
    const manifest: AssetManifest = {
      requests: [request],
      assets: [{ id: request.id, kind: "image", src: "https://cdn.example/hangzhou.jpg", alt: "杭州实景", provider: "openverse", license: "CC BY" }],
    };
    const serialized = JSON.stringify(buildOpenUIGenerationPayload(plan, manifest));

    expect(serialized).toContain('"requestId":"asset_card_detail_1"');
    expect(serialized).toContain('"aspect":"wide"');
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("openverse");
    expect(serialized).not.toContain("CC BY");
  });

  it("requires accepted assets in their owning card and supplies targeted repair metadata", () => {
    const plan: CardPlan = {
      skillName: "媒体",
      reasoning: "媒体覆盖",
      cards: [
        { id: "detail", purpose: "图片详情", blocks: [{ kind: "hero", text: "杭州", assetRequest: { kind: "image", query: "杭州酒店", count: 1, role: "hero", aspect: "wide" } }] },
        { id: "other", purpose: "其他", blocks: [{ kind: "summary", text: "其他内容" }] },
      ],
    };
    const manifest: AssetManifest = {
      requests: [{ id: "asset_detail_1", cardId: "detail", kind: "image", query: "杭州酒店", count: 1, role: "hero", aspect: "wide" }],
      assets: [{ id: "asset_detail_1", kind: "image", src: "https://cdn.example/hz.jpg", alt: "杭州酒店" }],
    };
    const missingCode = [
      'root = CardDeck([detail, other], "auto")',
      'detail = GeneratedCard("detail", "详情", [detail_body])',
      'other = GeneratedCard("other", "其他", [other_body])',
      'detail_body = TextContent("杭州")',
      'other_body = TextContent("其他内容")',
    ].join("\n");
    const missing = assetCoverage(missingCode, manifest);
    expect(missing.valid).toBe(false);
    expect(missing).toMatchObject({ required: 1, matched: 0 });
    expect(missing.missing[0]).toMatchObject({
      requestId: "asset_detail_1",
      cardId: "detail",
      role: "hero",
      aspect: "wide",
      allowedAssetRefs: ["asset_detail_1"],
    });
    expect(buildOpenUIRepairPayload(plan, missingCode, {
      valid: false,
      errors: missing.errors,
      coverage: { required: 2, matched: 2, missing: [] },
      assetCoverage: missing,
      layoutCoverage: { mode: "free", valid: true, checkedCards: 0, withinBudget: 0, violations: [] },
      parser: { statements: 5, unresolved: [], orphaned: [], incomplete: false },
    })).toHaveProperty("missingAssets.0.requestId", "asset_detail_1");

    const wrongCard = `${missingCode}\nother_image = AssetImage("asset_detail_1", "杭州", "wide")\nother_body = Stack([other_image], "column", "m")`;
    expect(assetCoverage(wrongCard, manifest).errors.join(" ")).toContain("错误卡片");

    const validCode = `${missingCode}\ndetail_image = AssetImage("asset_detail_1", "杭州", "wide")\ndetail_body = Stack([detail_image], "column", "m")`;
    const valid = assetCoverage(validCode, manifest);
    expect(valid.valid).toBe(true);
    expect(valid).toMatchObject({ required: 1, matched: 1, missing: [] });
  });

  it("requires two accepted gallery refs but degrades a one-result gallery to one image", () => {
    const request = { id: "asset_gallery_1", cardId: "gallery", kind: "gallery" as const, query: "两个酒店", count: 3, role: "gallery" as const, aspect: "square" as const };
    const base = 'root = CardDeck([card], "auto")\ncard = GeneratedCard("gallery", "画廊", [body])';
    const twoAssets: AssetManifest = { requests: [request], assets: [
      { id: "asset_gallery_1_1", kind: "image", src: "https://cdn.example/1.jpg", alt: "一" },
      { id: "asset_gallery_1_2", kind: "image", src: "https://cdn.example/2.jpg", alt: "二" },
    ] };
    const insufficient = assetCoverage(`${base}\nbody = AssetGallery(["asset_gallery_1_1"])`, twoAssets);
    expect(insufficient.missing[0]).toMatchObject({ requiredCount: 2 });
    expect(insufficient.valid).toBe(false);

    const oneAsset: AssetManifest = { requests: [request], assets: [twoAssets.assets[0]] };
    expect(assetCoverage(`${base}\nbody = AssetImage("asset_gallery_1_1", "一", "square")`, oneAsset).valid).toBe(true);
  });

  it("does not require unresolved requests", () => {
    const { plan } = ensureAssetRequests(banyanTreePlan, "请提供图片");
    const manifest: AssetManifest = { requests: [{ id: "asset_card_detail_1", cardId: "card_detail", ...plan.cards[1].blocks[0].assetRequest! }], assets: [] };
    const code = [
      'root = CardDeck([list, detail], "auto")',
      'list = GeneratedCard("card_list", "列表", [list_body])',
      'detail = GeneratedCard("card_detail", "详情", [detail_body])',
      'list_body = TextContent("列表")',
      'detail_body = TextContent("详情")',
    ].join("\n");
    const validation = assetCoverage(code, manifest);
    expect(validation).toMatchObject({ required: 0, matched: 0, missing: [] });
    expect(validation.valid).toBe(true);
  });
});
