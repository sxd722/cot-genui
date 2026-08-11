# A2UI 卡片生成规范（第8步）

你将第7步的语义卡片设计翻译成 **A2UI JSONL**——一套标准化的 UI 描述消息，用于在 2x4 手机桌面卡片上渲染交互界面。

## 输出格式

输出一个 JSON 数组，每条消息是一个对象：

```json
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "card",
      "catalogId": "https://a2ui.org/specification/v0_9/standard_catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "card",
      "components": [ ...扁平邻接表... ]
    }
  },
  {
    "version": "v0.9",
    "updateDataModel": {
      "surfaceId": "card",
      "path": "/",
      "value": { ...初始数据... }
    }
  }
]
```

## 核心规则（必须遵守）

1. **第一条消息必须是 createSurface**
2. **组件是扁平邻接表**——所有组件平铺在一个数组里，通过 ID 引用建立父子关系，**禁止内联嵌套**
3. **每个组件必须有 `id`（全局唯一）和 `component`（组件类型名）**
4. **Card.child / Button.child 只接受单个 ID**——多个子元素必须包在 Column/Row 里
5. **Column/Row/List 的 `children` 是 ID 数组**
6. **数据绑定用 `{ "path": "/json/pointer" }`**——需要动态数据时用 updateDataModel 初始化

## 18 个标准组件

### 布局容器
| 组件 | 关键属性 |
|---|---|
| **Column** | `children`(ID数组,必填), `justify`(start/center/end/spaceBetween/spaceEvenly), `align`(start/center/end) |
| **Row** | 同 Column，水平布局 |
| **List** | `children`(ID数组), `direction`(vertical/horizontal) |

### 展示
| 组件 | 关键属性 |
|---|---|
| **Text** | `text`(字符串,必填), `variant`(h1/h2/h3/h4/h5/body/caption) |
| **Image** | `url`(字符串,必填), `fit`(contain/cover/fill), `variant`(icon/avatar/smallFeature/mediumFeature/largeFeature) |
| **Icon** | `name`(预设枚举) |
| **Divider** | `axis`(horizontal/vertical) |

### 交互
| 组件 | 关键属性 |
|---|---|
| **Button** | `child`(单个ID,必填), `action`(必填), `variant`(default/primary/borderless) |
| **TextField** | `label`, `value`, `variant`(shortText/longText/number/obscured) |
| **CheckBox** | `label`, `value` |
| **Slider** | `value`, `min`, `max` |
| **ChoicePicker** | `options`(数组), `value`, `variant`(mutuallyExclusive/mutuallyInclusive) |

### 容器
| 组件 | 关键属性 |
|---|---|
| **Card** | `child`(单个ID,必填) |
| **Tabs** | `tabs`(数组,每项含 title + child) |

## Action 机制（交互）

Button 等组件的 `action` 字段，二选一：

```json
// 上报事件（服务端处理）
"action": { "event": { "name": "selectTier", "context": { "tier": "standard" } } }

// 本地函数
"action": { "functionCall": { "call": "openUrl", "args": { "url": "https://..." }, "returnType": "void" } }
```

## 2x4 桌面卡片约束

- **尺寸**：2列 × 4行 的手机桌面卡片（约 320×640px）
- **用 Column + Row 嵌套**模拟网格布局（标准目录无 Grid）
- **内容紧凑**：每张卡信息密度高，文字精简
- **深色主题**：背景 #0B0D10，强调色 #D7AE59

## 完整示例（旅游概览卡）

```json
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "trip",
      "catalogId": "https://a2ui.org/specification/v0_9/standard_catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "trip",
      "components": [
        { "id": "root", "component": "Card", "child": "main_col" },
        { "id": "main_col", "component": "Column", "children": ["title", "info_row", "divider1", "desc", "divider2", "btn_row"], "justify": "start" },

        { "id": "title", "component": "Text", "text": "北京4天亲子游", "variant": "h3" },

        { "id": "info_row", "component": "Row", "children": ["info_origin", "info_date"], "justify": "spaceBetween" },
        { "id": "info_origin", "component": "Text", "text": "上海 → 北京", "variant": "caption" },
        { "id": "info_date", "component": "Text", "text": "8月20-24日", "variant": "caption" },

        { "id": "divider1", "component": "Divider", "axis": "horizontal" },

        { "id": "desc", "component": "Text", "text": "一家三口·故宫+动物园+颐和园·高铁往返", "variant": "body" },

        { "id": "divider2", "component": "Divider", "axis": "horizontal" },

        { "id": "btn_row", "component": "Row", "children": ["btn_attractions", "btn_itinerary"], "justify": "spaceBetween" },
        { "id": "btn_attractions", "component": "Button", "child": "btn_attr_text", "variant": "primary", "action": { "event": { "name": "goto", "context": { "card": "attractions" } } } },
        { "id": "btn_attr_text", "component": "Text", "text": "景点" },
        { "id": "btn_itinerary", "component": "Button", "child": "btn_itin_text", "variant": "default", "action": { "event": { "name": "goto", "context": { "card": "itinerary" } } } },
        { "id": "btn_itin_text", "component": "Text", "text": "行程" }
      ]
    }
  }
]
```

## 多卡片导航（Navigation Flow）

第7步通常设计了多张卡片。每张卡翻译成一个独立的 **surface**（一个 createSurface + 一个 updateComponents）。
用户通过 Button 的 action 事件在卡片间导航。

### event 命名规范（渲染器识别这些事件名）

| event.name | context | 效果 |
|---|---|---|
| `goto` | `{ "card": "surfaceId" }` | 切换到指定卡片 |
| `navigate` | `{ "card": "surfaceId" }` | 同 goto |
| `select` | `{ "key": "slot名", "value": "值", "goto": "目标surface" }` | 写入选择值 + 可选跳转 |
| `back` | `{}` | 返回上一张卡 |
| `copy` | `{ "text": "内容" }` | 模拟复制 |
| `save` | `{}` | 模拟保存 |
| `llm` | `{ "prompt": "分析请求" }` | 模拟 AI 调用 |

### 多卡片示例（2张卡 + 导航）

```json
[
  {
    "version": "v0.9",
    "createSurface": { "surfaceId": "overview", "catalogId": "https://a2ui.org/specification/v0_9/standard_catalog.json" }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "overview",
      "components": [
        { "id": "root", "component": "Card", "child": "col" },
        { "id": "col", "component": "Column", "children": ["title", "desc", "btn_next"] },
        { "id": "title", "component": "Text", "text": "概览", "variant": "h3" },
        { "id": "desc", "component": "Text", "text": "点击下方查看详情" },
        { "id": "btn_next", "component": "Button", "child": "btn_next_t", "variant": "primary",
          "action": { "event": { "name": "goto", "context": { "card": "detail" } } } },
        { "id": "btn_next_t", "component": "Text", "text": "查看详情" }
      ]
    }
  },
  {
    "version": "v0.9",
    "createSurface": { "surfaceId": "detail", "catalogId": "https://a2ui.org/specification/v0_9/standard_catalog.json" }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "detail",
      "components": [
        { "id": "root2", "component": "Card", "child": "col2" },
        { "id": "col2", "component": "Column", "children": ["title2", "info2", "btn_back"] },
        { "id": "title2", "component": "Text", "text": "详情", "variant": "h3" },
        { "id": "info2", "component": "Text", "text": "这是详情内容" },
        { "id": "btn_back", "component": "Button", "child": "btn_back_t", "variant": "default",
          "action": { "event": { "name": "back" } } },
        { "id": "btn_back_t", "component": "Text", "text": "返回" }
      ]
    }
  }
]
```

渲染器会自动在顶部显示导航条（多卡片时），用户可点击切换。Button 的 goto/back 也会切换卡片。

## 设计原则

1. **每张语义卡片翻译成一个独立 surface**（createSurface + updateComponents）
2. **尽量丰富的组件**：不要只用 Text，善用 Button/Image/Icon/Divider/ChoicePicker/Slider/Tabs 等
3. **扁平邻接表**：所有组件平铺，ID 引用——这是最易错的规则
4. **2x4 紧凑布局**：信息密度高，文字精简
5. **交互完整**：第7步描述的每个 action 都要用上表的 event.name 映射
6. **导航完整**：卡片间用 `goto` 连接，返回用 `back`，形成完整的导航流
