import { describe, expect, it } from "vitest";
import { createParser, type LibraryJSONSchema } from "@openuidev/lang-core";
import librarySpec from "../../src/openui/generated/system-prompt.spec.json";

describe("semantic OpenUI components", () => {
  it("parses all high-value semantic component contracts", () => {
    const code = `root = CardDeck([card], "auto")
card = GeneratedCard("quality", "Quality", [body], "data", "balanced")
body = Stack([metrics, timeline, recommendations, comparison, hero, panel], "column", "m")
metrics = MetricRow([{label:"预算",value:"¥800",detail:"含交通"}])
timeline = Timeline([{title:"准备",detail:"确认范围",meta:"09:00"}])
recommendations = RecommendationGrid([{title:"方案 A",detail:"更均衡",badge:"推荐",assetRef:"asset_demo"}])
comparison = ComparisonGrid([{title:"方案 A",rows:[{label:"预算",value:"¥800"}],badge:"推荐"}])
hero = MediaHero("主结论", "先看重点", "asset_demo", ["均衡"])
panel = ActionPanel("继续", "选择下一步", [action])
action = HostActionChip("确认", "plan:quality:confirm")`;
    const parsed = createParser(librarySpec.schema as LibraryJSONSchema).parse(code);
    expect(parsed.root?.typeName).toBe("CardDeck");
    expect(parsed.meta.errors).toEqual([]);
    expect(parsed.meta.unresolved).toEqual([]);
  });
});
