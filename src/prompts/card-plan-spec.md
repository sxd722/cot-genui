# CardPlan IR 规范（第 7 步 generate 专用）

你在第 7 步要产出一个 `cardPlan` 对象——一份"卡片设计意图"。这不是代码，而是语义化的设计描述：选 block 类型 + 填内容 + 连接数据流。编译器会把它机械地翻译成可渲染的卡片 DSL。

## 顶层结构

```json
{
  "skillName": "卡片组标题（如「北京亲子游」）",
  "iconText": "单个字符（如 B）",
  "reasoning": "你的设计思路（1-2句话）",
  "cards": [ ...卡片数组，3-6张... ]
}
```

## 每张卡的结构

```json
{
  "id": "稳定ID（snake_case，如 overview / attractions）",
  "purpose": "这张卡的用途",
  "blocks": [ ...内容块... ],
  "actions": [ ...操作按钮（可空，纯展示卡省略）... ]
}
```

## Block 菜单（选 kind + 填内容）

| kind | 用途 | 关键字段 |
|---|---|---|
| `hero` | 首屏大标题 | `title`, `text` |
| `summary` | 主副两行摘要 | `title`, `value`(或`valueFromSlot`), `detail` |
| `list` | 列表（项可带点击动作） | `title`, `items`(或`itemsFromSlot`) |
| `progress` | 进度条 | `title`, `valueFromSlot`, `value` |
| `status` | 状态/告警 | `title`, `text`, `tone`("danger"/"warning") |
| `metric` | 数值指标 | `title`, `metrics: [{label,value,unit}]` |
| `choice` | 互斥选项 | `title`, `options`, `currentFromSlot` |
| `toggle` | 布尔开关 | `title`, `currentFromSlot` |

**内容来源**（二选一）：
- `value: "直接文本"` — 直接给值
- `valueFromSlot: "slot名"` — 引用前序步骤推断的槽位（编译器会自动放入 initialState）

**列表内容**（二选一）：
- `items: [{label:"故宫", onSelect:{...}}]` — 直接给项（可带点击动作）
- `itemsFromSlot: "itinerary"` — 引用 list 型槽位

## 列表项的点击动作（数据流的核心）

列表项可以带 `onSelect`，实现"点击→写状态→跳卡"的数据流：

```json
{
  "label": "故宫博物院",
  "onSelect": {
    "writeTo": "selectedSpot",
    "value": "故宫",
    "thenGoTo": "spot-detail"
  }
}
```

这会编译成：点击故宫 → 把"故宫"写入 state → 跳到 spot-detail 卡。spot-detail 卡用 `valueFromSlot: "selectedSpot"` 读取，显示故宫的详情。

## Action 菜单（操作按钮）

| type | 用途 | 关键字段 |
|---|---|---|
| `navigate` | 跳到另一张卡 | `targetCardId` |
| `pick-file` | 选择文件 | `targetCardId`(成功后跳哪) |
| `ocr` | 文字识别 | `targetCardId` |
| `copy` | 复制到剪贴板 | `copyText` |
| `save` | 保存文件 | — |
| `llm-call` | AI 分析/建议 | — |
| `confirm` | 确认/提交 | — |

```json
{ "id": "go-detail", "label": "查看详情", "type": "navigate", "targetCardId": "detail", "role": "primary" }
```

role: `primary`(主操作) / `secondary`(次操作) / `tertiary`(辅助)

## 完整示例

```json
{
  "skillName": "北京亲子游",
  "iconText": "B",
  "reasoning": "已确定目的地北京、一家三口、8月出行。设计5卡：概览→景点(可点击)→景点详情→行程→清单。",
  "cards": [
    {
      "id": "overview",
      "purpose": "行程概览",
      "blocks": [
        { "kind": "hero", "title": "北京4天亲子游", "text": "一家三口·8月20日出发" },
        { "kind": "summary", "title": "出行人", "valueFromSlot": "travel_party", "value": "一家三口（含3岁女儿）" }
      ],
      "actions": [
        { "id": "go-attractions", "label": "查看景点", "type": "navigate", "targetCardId": "attractions" }
      ]
    },
    {
      "id": "attractions",
      "purpose": "推荐景点（可点击查看详情）",
      "blocks": [
        {
          "kind": "list", "title": "推荐景点",
          "items": [
            { "label": "故宫博物院", "onSelect": { "writeTo": "selectedSpot", "value": "故宫", "thenGoTo": "spot-detail" } },
            { "label": "北京动物园", "onSelect": { "writeTo": "selectedSpot", "value": "动物园", "thenGoTo": "spot-detail" } }
          ]
        }
      ]
    },
    {
      "id": "spot-detail",
      "purpose": "选中景点详情",
      "blocks": [
        { "kind": "summary", "title": "景点详情", "valueFromSlot": "selectedSpot", "text": "预约信息、开放时间、亲子提示" }
      ],
      "actions": [
        { "id": "back", "label": "返回列表", "type": "navigate", "targetCardId": "attractions", "role": "secondary" }
      ]
    }
  ]
}
```

## 设计原则

1. **3-6 张卡**，用 navigate 串联成流程
2. **第一张用 hero** 说明任务，**最后一张通常是 list/summary** 展示清单或总结
3. **需要用户选的环节**用 choice（选项少）或可点击 list（选项多）
4. **valueFromSlot 优先**：如果前序步骤已推断出某个槽位值，用 valueFromSlot 引用它，让编译器自动填入
5. **文案紧凑**：标题≤18字，按钮≤8字，说明≤60字
6. 纯展示卡可以没有 actions

## 缺失信息识别（missingInfo）

如果某张卡或某个 block 需要的信息**不在前序推理结果中**，你可以声明 `missingInfo`，系统会自动尝试补齐（web 搜索或 LLM 推理）。

两种缺失类型：
- **外部客观信息**：实时股价、天气、政策利率、景点门票价格等——标注 `source: "web_search"`
- **推理生成信息**：行动清单、注意事项、对比分析等——标注 `source: "llm_reasoning"`

```json
{
  "kind": "metric",
  "title": "贵州茅台实时行情",
  "missingInfo": {
    "query": "贵州茅台 600519 今日股价",
    "source": "web_search",
    "fallback": "数据加载中…"
  }
}
```

```json
{
  "kind": "list",
  "title": "购房行动清单",
  "missingInfo": {
    "query": "上海改善置换购房的完整行动清单，包括旧房评估、公积金查询、征信打印、银行对比等步骤",
    "source": "llm_reasoning",
    "fallback": "清单生成中…"
  }
}
```

系统补齐后，结果会自动填入该 block 的 value/items 字段。**只对真正缺失的信息标注 missingInfo**，前序已推断出的槽位值用 valueFromSlot 引用即可。
