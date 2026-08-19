# cot-genui · Design Document

> 最后更新：2026-08-11  
> 版本：v0.3（含 A2UI 卡片生成 + 液态玻璃渲染）  
> 仓库：https://github.com/sxd722/cot-genui

---

## 1. 项目概述

cot-genui 是一个 **意图消歧 + 卡片生成** 的全链路可视化工具。它解决一个核心问题：

> 面对用户模糊意图（"帮我规划去北京旅游"），LLM 如何结合设备使用记录等本地上下文，推断出用户真实诉求，并最终生成可交互的卡片界面？

系统将这个黑箱过程拆解为 **9 步可解释管线**（⓪~⑧），每步可独立触发、观测、调试，并最终产出两种卡片形态：DSL 卡片（结构化 IR → 编译 → 渲染）和 A2UI 卡片（标准协议 → 液态玻璃 iframe 渲染）。

---

## 2. 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        主流程（9 步管线）                          │
│                                                                  │
│  用户 query + device_context                                     │
│    │                                                             │
│    ├─ ⓪ slot_definition    自行定义任务槽位                        │
│    ├─ ① surface_parse      表层动作解析                           │
│    ├─ ② sufficiency_check  充分性判定                             │
│    ├─ ③ context_mining     从设备上下文挖掘证据+置信度              │
│    ├─ ④ conflict_detection 多源冲突检测                           │
│    ├─ ⑤ triage             高/中/低置信分流                       │
│    ├─ ⑥ clarifying_questions 最小化提问（暂停等用户回答）          │
│    ├─ ⑦ generate           生成方案（IR模式/语义Markdown模式）      │
│    │    ├─ cardPlan (IR)   → 编译器 → DSL → 校验 → 渲染            │
│    │    ├─ cardPlanMarkdown → 纯markdown描述                      │
│    │    ├─ reasoningGraph  → 推理DAG (mermaid)                    │
│    │    └─ enrich          → missingInfo自动补齐                   │
│    └─ ⑧ a2ui_generate      将⑦结果翻译为A2UI JSONL               │
│         └─ Liquid Glass iframe 渲染                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 16 (App Router) + React 19 + TypeScript |
| 样式 | Tailwind CSS v4 |
| 状态 | Zustand |
| LLM | OpenAI SDK（兼容 GLM/GPT/DeepSeek 等任意端点） |
| YAML 解析 | js-yaml（semantic 模式） |
| 代码量 | ~7800 行 TypeScript/TSX |

---

## 3. 核心模块

### 3.1 消歧管线（`src/lib/llm.ts`）

9 步分步推理，每步独立调用 LLM：

- 每步可单独触发（▶ 按钮）或一键全部
- 一键全部在 ⑥ 提问后暂停，等用户回答再继续 ⑦⑧
- 每步记录：耗时(s) + Token 消耗 + 估算费用($)
- Structured Output (json_schema) 约束输出格式
- JSON 围栏容错 (`extractJson`) + 字段上提兜底

**调用模式**：
- 步骤 ⓪~⑥⑧：`callLLM`（structured output, json_schema strict）
- 步骤 ⑦ IR 模式：`callLLM`（同上）
- 步骤 ⑦ 语义模式：`callLLMMarkdown`（普通 completion，零转义 markdown 输出）

### 3.2 生成模式（genMode）

顶栏可切换两种第 7 步生成模式：

| 模式 | 输出格式 | 解析方式 | 用途 |
|---|---|---|---|
| **IR 模式**（默认） | 结构化 CardPlan JSON | 编译器 → DSL → 渲染 | 精确、可编译、有校验 |
| **语义模式** | 纯 Markdown 文本 | 正则解析 `parseMarkdownBlueprint` | 自由、高容错、给后续 LLM |

#### IR 模式链路
```
CardPlan IR → enrichCardPlan(补齐missingInfo) → compileCardPlan → validateArtifact → DslCardHost渲染
```

#### 语义模式链路
```
纯Markdown → parseMarkdownBlueprint(正则分割卡片) → SemanticMarkdownView渲染
```

### 3.3 DSL 引擎（`src/dsl/`）

两层契约体系：

**底层 CardArtifact DSL**（spec 级，跨端共享）：
- `types.ts` — CardArtifact/Flow/DSL/Block/Action 类型（1:1 映射 spec §3）
- `validate.ts` — 15 条全局不变量校验
- `reducer.ts` — Flow 状态机（event→transition，纯函数）
- `runtime.ts` — State 管理 + local action 执行
- `catalogs.ts` — 数据目录 + 工具目录（通用 + 旅行/购房扩展）

**上层 CardPlan IR**（模型产出，语义化）：
- `modules.ts` — IR 类型定义（CardNode/IRBlock/IRAction/IRListItem/onSelect 数据流）
- `compiler.ts` — IR → CardArtifact 确定性编译器（零模型调用）
- `enrichPlan.ts` — missingInfo 自动补齐（web_search / llm_reasoning）

**Web 渲染层**：
- `DslCardHost.tsx` — 顶层宿主（useReducer 驱动 runtime+flow）
- `DslCardView.tsx` — 单卡组装
- `blocks/index.tsx` — 8 种专门 block + 降级 block
- `toolExecutor.ts` — 工具执行器（文件选择/保存/复制/OCR mock/LLM 调用）

### 3.4 A2UI 卡片生成（第 8 步）

```
第7步产出（cardPlanMarkdown / cardPlan）
  → 拼接 prompt（注入第7步结果 + A2UI 组件规范 + 2x4约束）
  → GLM 生成 A2UI JSONL（createSurface + updateComponents）
  → renderA2UIIframe（iframe 内 Liquid Glass 渲染）
```

**A2UI 渲染引擎特性**：
- 18 个标准组件的完整 DOM 构建
- 多 surface 导航（goto/select/back 事件处理）
- DataModel 双向绑定
- Liquid Glass 设计系统（半透明 + backdrop-blur + 内发光边缘 + 浮动光球）
- iframe 沙箱隔离

### 3.5 推理流程图（DAG）

第 7 步 GLM 额外输出 `reasoningGraph`（mermaid 文本），展示从槽位到卡片内容的推理依赖：
- S 节点（slot）：标注来源 + 置信度
- R 节点（推理）：标注"从什么推到什么"
- C 节点（卡片）：最终输出

展示在中栏 CoT 底部，可复制到 mermaid.live 查看图形。

---

## 4. UI 架构

### 三栏布局

```
┌─────────────┬──────────────────────┬─────────────────┐
│  输入区      │   CoT 推理可视化      │   结果区         │
│ (360px)     │   (flex-1)           │   (360px)       │
│             │                      │                 │
│ · query     │  ⓪~⑧ 步骤卡片        │  视图下拉框：     │
│ · 上下文预设 │  每步：▶触发 状态     │  📋 DSL卡片渲染  │
│ · JSON编辑   │  耗时·token·费用      │  🎴 堆叠卡片     │
│ · 重置       │  ▸展开推理过程+日志   │  📝 语义描述     │
│             │                      │  📦 Blueprint JSON│
│             │  槽位推断表           │  📱 A2UI渲染    │
│             │  (置信度色条)         │  🔧 Raw IR      │
│             │                      │                 │
│             │  冲突 / 提问(可交互)   │  DSL: 校验状态   │
│             │  推理DAG(mermaid)     │  + 编译诊断      │
│             │                      │  + 补齐进度      │
└─────────────┴──────────────────────┴─────────────────┘
```

### 顶栏

- 生成模式切换：`🔧 结构化 IR → DSL` / `📝 纯语义描述`
- 一键全部：⓪~⑥ → 暂停 → `▶ 继续生成`（绿色）→ ⑦⑧
- Mock 标识（未配置 LLM_API_KEY 时）

### 右栏 6 视图

| 视图 | 数据源 | 说明 |
|---|---|---|
| 📋 DSL 卡片渲染 | compiledArtifact | 编译后的 CardArtifact → DslCardHost 交互 |
| 🎴 堆叠卡片 | result.cards | 旧的 StackedCards（翻转动效） |
| 📝 语义描述 | cardPlanMarkdown | 混写 markdown 渲染（@引用/action链接高亮） |
| 📦 Blueprint JSON | cardPlanMarkdown / cardPlan | 原始 JSON，可复制给后续 LLM |
| 📱 A2UI 渲染 | a2uiJsonl | iframe 内 Liquid Glass 卡片 |
| 🔧 Raw IR | cardPlan | GLM 产出的原始 CardPlan IR |

---

## 5. Prompt 体系

| 文件 | 用途 |
|---|---|
| `prompts/system.md` | 8 步消歧管线总指令 + 三条铁律 |
| `prompts/card-plan-spec.md` | IR 模式：CardPlan 结构 + block/action 菜单 + onSelect 数据流 + reasoningGraph |
| `prompts/semantic-markdown-spec.md` | 语义模式：纯 markdown 格式 + Card N 分隔 + data/action 索引 |
| `prompts/a2ui-spec.md` | 第 8 步：A2UI 组件规范 + 18 标准组件 + 多 surface 导航 + event 命名 |
| `prompts/slots-travel.ts` | 旅游场景槽位定义（遗留，已由动态 slot_definition 取代） |

---

## 6. API 端点

| 端点 | 方法 | 用途 |
|---|---|---|
| `/api/infer` | POST | 分步推理（step 参数指定步骤） |
| `/api/llm` | POST | 卡片内 LLM 调用（股票 AI 建议等） |
| `/api/search` | POST | web 搜索（missingInfo 补齐） |

### 环境变量

```bash
LLM_API_KEY=          # API Key（必填才走真实推理）
LLM_BASE_URL=         # 兼容端点（GLM/DeepSeek/Azure 等）
LLM_MODEL=            # 模型名（默认 gpt-4o-mini）
NEXT_PUBLIC_LLM_MODEL= # 前端可见的模型名（用于费用估算）
```

---

## 7. 预设场景

### 推理上下文预设（左栏可切换）

| 预设 | 描述 |
|---|---|
| 完整画像 · 林晓 | 30岁上海程序员，含身份/家庭/日程/购物/健康/财务等（含信号冲突） |
| 杭州上班族 | 年假已定，搜过亲子游（与通讯录冲突） |
| 带娃家庭 | 三口之家，信号一致 |
| 极简上下文 | 信息严重不足，验证提问步骤 |

### DSL 场景（`/dsl-demo` 页）

| 场景 | 类型 | 说明 |
|---|---|---|
| 旅游规划 | IR 编译 | 景点列表可点击→详情（数据流 demo） |
| 读书笔记 | IR 编译 | 图片/图表降级（3 处 notice） |
| PDF 识别 | IR 编译 | spec 原生场景，工具调用链路 |
| 股票跟踪 | IR 编译 | metric 降级 + LLM 调用 |
| 购房规划 | GLM 预编译 | GLM 真实生成 6 卡（含方案对比数据流） |

---

## 8. 文件结构

```
src/
├── app/
│   ├── page.tsx                    主页面（三栏布局 + 6 视图切换）
│   ├── layout.tsx
│   ├── dsl-demo/page.tsx           DSL 场景验证页
│   └── api/
│       ├── infer/route.ts          分步推理 API
│       ├── llm/route.ts            卡片内 LLM 调用
│       └── search/route.ts         web 搜索（missingInfo 补齐）
│
├── components/
│   ├── A2UIRenderer.tsx            A2UI 渲染器 + Liquid Glass iframe
│   ├── CotTrace.tsx                中栏：9步推理可视化 + DAG + 提问交互
│   ├── InputPanel.tsx              左栏：query + 上下文编辑 + 预设
│   ├── ResultPanel.tsx             右栏空状态
│   ├── SlotTable.tsx               槽位推断表（置信度色条）
│   ├── StackedCards.tsx            旧卡片（翻转动效）
│   └── dsl/
│       ├── DslCardHost.tsx         DSL 渲染宿主（runtime + flow）
│       ├── DslCardView.tsx         单卡组装
│       ├── ActionButton.tsx        action 按钮
│       ├── ThemeProvider.tsx       主题 token → CSS 变量
│       ├── Binding.ts              useBinding hook
│       └── blocks/index.tsx        8 种专门 block + 降级
│
├── dsl/
│   ├── types.ts                    CardArtifact 类型（spec 1:1 映射）
│   ├── modules.ts                  CardPlan IR 类型
│   ├── compiler.ts                 IR → CardArtifact 编译器
│   ├── validate.ts                 15 条不变量校验
│   ├── reducer.ts                  Flow 状态机
│   ├── runtime.ts                  State 管理 + local action
│   ├── catalogs.ts                 数据目录 + 工具目录
│   ├── toolExecutor.ts             Web 端工具实现
│   ├── enrichPlan.ts               missingInfo 自动补齐
│   ├── sample.ts                   旅行 demo artifact
│   ├── scenarios.ts                4 场景 IR
│   ├── housing-scenario.ts         购房场景推理上下文
│   └── housing-artifact.json       购房场景 GLM 生成 artifact
│
├── lib/
│   ├── llm.ts                      LLM 客户端 + 9步推理 + 编译器接入
│   ├── schemas.ts                  输出 JSON Schema
│   ├── presets.ts                  预设设备上下文
│   └── format.ts                   toText 安全转换
│
├── prompts/
│   ├── system.md                   消歧管线总指令
│   ├── card-plan-spec.md           IR 模式规范
│   ├── semantic-markdown-spec.md   语义模式规范
│   ├── a2ui-spec.md                A2UI 生成规范
│   └── slots-travel.ts             遗留旅游槽位
│
├── store/
│   └── useInferStore.ts            Zustand 全局状态
│
└── docs/
    ├── DESIGN-DOC.md               本文档
    └── scenario-layoff.md          裁员场景推理上下文
```

---

## 9. 关键设计决策

### 9.1 IR 领先 spec
CardPlan IR 比 CardArtifact DSL 更丰富（可表达 image/chart/infographic/external-link/llm-call），编译器诚实降级。这样 IR 为 spec 扩展预留空间。

### 9.2 编译器是确定性的
IR → DSL 编译零模型调用——所有语法正确性（双侧 ID 一致、transition/event 格式、binding 命名空间）由代码保证。模型只负责"设计意图"。

### 9.3 语义模式零转义
语义模式用纯 markdown 输出（而非 JSON/YAML），彻底消除转义地狱。正则解析高容错，不追求严格正确。

### 9.4 missingInfo 自动补齐
GLM 在生成时可标注 `missingInfo`（外部客观信息用 web_search，推理信息用 llm_reasoning），系统自动调用 `/api/search` 或 `/api/llm` 补齐后再编译。

### 9.5 一键全部暂停机制
`runAll` 在 ⑥ 提问后暂停，等用户回答再继续 ⑦⑧——确保用户交互能影响最终方案。

---

## 10. 已验证场景

| 场景 | 9步管线 | 生成模式 | 渲染 | 备注 |
|---|---|---|---|---|
| 北京旅游 | ✅ 全链路 | IR | DSL 卡片 | GLM 一次性产出 5 卡（含景点数据流） |
| 购房规划 | ✅ 全链路 | IR | DSL 卡片 | GLM 产出 6 卡（含方案对比 onSelect） |
| 裁员应对 | ✅ 全链路 | IR | DSL 卡片 | 10 槽位 + 3 用户回答 |
| AI 编程工具推荐 | ✅ 全链路 | 语义 | CardPlan Markdown | 混写 markdown + data/action 索引 |
| PDF 文字识别 | ✅ DSL demo | — | DSL 卡片 | spec 原生场景，工具调用完整 |
| 读书笔记 | ✅ DSL demo | — | DSL 卡片 | 图片/图表降级（3 notice） |
| 股票跟踪 | ✅ DSL demo | — | DSL 卡片 | LLM 调用 + metric 降级 |

---

## 11. 待办与演进方向

- [ ] A2UI 渲染器引入 Lit Web Components（当前用 iframe + 纯 JS）
- [ ] 语义模式 → IR 模式的自动转换（第二次 LLM 调用）
- [ ] DSL spec 扩展：image block / chart block / 条件转移 / 数据驱动流
- [ ] 真实 OCR 接入（替换 mock）
- [ ] 鸿蒙 ArkUI 端渲染验证（跨端一致性）
- [ ] 多轮对话（用户纠正假设后重新生成）
- [ ] Mermaid 图形化渲染（引入 mermaid.js 替代源码展示）
