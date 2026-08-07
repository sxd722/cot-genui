# 语义化卡片 Blueprint 规范

你输出一套卡片的**语义化描述**——每张卡片是一整坨 markdown（混写内容/视觉/交互引用），末尾附 data 和 action 索引。这个输出后续会直接塞给另一个 LLM 自由发挥，所以重点是**信息完整、表达自然**，不需要严格 JSON 结构。

## 输出格式

输出 JSON 数组 `semanticCards`，每个元素描述一张卡：

```json
[
  {
    "name": "卡片标识(snake_case)",
    "content": "一整坨 markdown 字符串",
    "data": ["数据源描述1", "数据源描述2"],
    "action": ["操作描述1", "操作描述2"]
  }
]
```

只有 4 个字段：`name`（标识）、`content`（markdown 正文）、`data`（数据源索引）、`action`（操作索引）。

## content：混写 markdown

content 是一整坨 markdown 字符串。在里面自由混写内容、视觉、数据引用、交互链接。

### 开头一句话视觉基调

```
深色卡片，金色强调色，hero 布局。

然后是正文内容...
```

### 数据引用 @slot

在正文中用 `@slot_name` 引用前序推断的槽位值：

```
你是 @work_years 年经验的前端工程师，月入 ¥@monthly_income。
```

带兜底值：`预算 @budget_range(¥70-100/月)`

也可以引用外部数据（标记来源）：
```
实时股价 @stock_price ← https://finance.example.com/600519
```

### 交互链接 [文字](action:类型→目标)

用 markdown 链接语法描述可交互元素：

```
[选择经济档](action:select→card3)
[查看详细对比](action:goto→card4)
[GitHub Copilot 官网](action:external→https://copilot.github.com)
[AI 分析风险](action:llm→分析此方案的财务风险)
[复制摘要](action:copy)
[保存方案](action:save)
```

交互类型：`select`（选择写入）/ `goto`（跳卡）/ `external`（外链）/ `llm`（调AI）/ `copy` / `save`

### content 示例

```
深色卡片，金色强调，hero+summary 布局。

## AI 编程工具推荐

林晓你好！你是 @work_years 年经验的前端工程师，月入 ¥@monthly_income，消费风格 @budget_style。

基于你的画像，我推荐三档方案：
- **经济档**：通义灵码（免费） [选择](action:select→card3)
- **标准档**（推荐）：GitHub Copilot $@price_copilot/月 [选择](action:select→card3)
- **高效档**：Cursor Pro $@price_cursor/月 [选择](action:select→card3)

> 当前推荐基于假设生成，可在后续纠正。

[查看详细对比](action:goto→card4)
```

## data：数据源索引

每张卡末尾的 `data` 是字符串数组，列出这张卡依赖的数据来源。**允许想象/假设数据源**（后续 LLM 会自行判断）。

```json
"data": [
  "@monthly_income ← payment.monthly_income (推断值: 28000, 置信度0.55)",
  "@budget_style ← payment.budget_style (推断值: comfortable)",
  "@price_copilot ← https://copilot.github.com/pricing",
  "股票实时行情 ← GET /api/stock/600519",
  "用户信用评分 ← 需要从征信API获取，当前未知"
]
```

格式灵活，关键是说清楚：**引用了什么数据 + 从哪来 + 当前值/状态**。

## action：操作索引

每张卡末尾的 `action` 是字符串数组，列出这张卡上的可交互操作。

```json
"action": [
  "select: 用户选择推荐档位 → 写入 selected_tier → 跳转 card3",
  "goto: 查看详细对比 → card4",
  "external: 打开 GitHub Copilot 官网 https://copilot.github.com",
  "copy: 复制当前推荐摘要到剪贴板"
]
```

格式灵活，关键是说清楚：**什么操作 + 效果是什么**。

## 完整示例

```json
[
  {
    "name": "overview",
    "content": "深色卡片，金色强调，hero 布局。\n\n## AI 编程工具推荐\n\n林晓你好！你是 @work_years 年经验的前端工程师，月入 ¥@monthly_income。\n\n三档方案：\n- 经济档：通义灵码（免费） [选择](action:select→card3)\n- 标准档：GitHub Copilot $@price_copilot/月 [选择](action:select→card3)\n- 高效档：Cursor Pro $@price_cursor/月 [选择](action:select→card3)\n\n[查看对比](action:goto→card4)",
    "data": [
      "@work_years ← identity.work_years (7)",
      "@monthly_income ← payment.monthly_income (28000)",
      "@price_copilot ← https://copilot.github.com/pricing ($10)",
      "@price_cursor ← https://cursor.sh/pricing ($20)"
    ],
    "action": [
      "select: 选择档位 → 写入 selected_tier → card3",
      "goto: 详细对比 → card4"
    ]
  },
  {
    "name": "detail",
    "content": "浅色卡片，蓝色强调，对比表格布局。\n\n## Copilot vs Cursor\n\n| 特性 | Copilot | Cursor |\n|---|---|---|\n| 价格 | $@price_copilot/月 | $@price_cursor/月 |\n| 代码补全 | ✅ 最强 | ✅ 强 |\n| 对话辅助 | ✅ | ✅ 更强 |\n| 整文件生成 | ❌ | ✅ Composer |\n\n[返回推荐](action:goto→card1) [开始试用](action:external→https://copilot.github.com)",
    "data": [
      "@price_copilot ← https://copilot.github.com/pricing",
      "@price_cursor ← https://cursor.sh/pricing",
      "功能对比 ← LLM 知识库（可能过时）"
    ],
    "action": [
      "goto: 返回推荐 → card1",
      "external: 开始试用 → https://copilot.github.com"
    ]
  }
]
```

## 设计原则

1. **3-6 张卡**，用 `[xxx](action:goto→cardN)` 串联流程
2. **content 写真实内容**，不要"此处放XXX"
3. **@ 引用嵌入正文**，让内容读起来自然
4. **data/action 允许幻觉**——可以想象数据源和操作，后续 LLM 会判断可行性
5. **视觉基调开头一句话**，不要长篇描述样式
6. content 里的 action 链接和末尾 action 索引**互补**：前者是内联引用，后者是结构化清单
