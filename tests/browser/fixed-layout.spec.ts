import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const applicationCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function card(index: number): string {
  return `<article class="openui-generated-card openui-generated-card--density-compact" data-card-id="card_${index}">
    <header class="openui-generated-card__header"><h2>卡片 ${index} 的结论</h2></header>
    <div class="openui-generated-card__body">
      <div class="openui-fixed-card-content">
        <div class="openui-fixed-card-content__primary">
          <ul class="openui-fixed-facts">
            <li>完整显示一项包含中文和 EnglishLongWordWithoutNaturalBreaks 的关键信息。</li>
            <li>第二项事实用于验证真实浏览器中的换行高度。</li>
            <li>第三项事实保持简洁，但不能被截断。</li>
            <li>第四项事实仍需完整可见。</li>
          </ul>
        </div>
        <div class="openui-fixed-card-content__actions"><div class="openui-fixed-actions"><button class="openui-action-chip">确认</button><button class="openui-action-chip">查看详情</button></div></div>
      </div>
    </div>
  </article>`;
}

for (const count of [1, 6, 12]) {
  test(`${count} fixed cards remain exactly 600x300 without internal overflow`, async ({ page }) => {
    await page.setContent(`<style>${applicationCss}\n*{box-sizing:border-box}html,body,h2,ul{margin:0;padding:0}</style>
      <main class="openui-host" data-card-layout="fixed-600x300"><section class="openui-card-deck">${Array.from({ length: count }, (_, index) => card(index + 1)).join("")}</section></main>`);
    await page.evaluate(async () => { await document.fonts.ready; });

    const measurements = await page.locator("[data-card-id]").evaluateAll((cards) => cards.map((element) => {
      const cardElement = element as HTMLElement;
      const header = cardElement.querySelector<HTMLElement>(".openui-generated-card__header")!;
      const body = cardElement.querySelector<HTMLElement>(".openui-generated-card__body")!;
      return {
        width: cardElement.getBoundingClientRect().width,
        height: cardElement.getBoundingClientRect().height,
        cardOverflow: cardElement.scrollHeight > cardElement.clientHeight + 1 || cardElement.scrollWidth > cardElement.clientWidth + 1,
        headerOverflow: header.scrollHeight > header.clientHeight + 1 || header.scrollWidth > header.clientWidth + 1,
        bodyOverflow: body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1,
      };
    }));

    expect(measurements).toHaveLength(count);
    for (const measurement of measurements) {
      expect(measurement.width).toBe(600);
      expect(measurement.height).toBe(300);
      expect(measurement.cardOverflow).toBe(false);
      expect(measurement.headerOverflow).toBe(false);
      expect(measurement.bodyOverflow).toBe(false);
    }
  });
}
