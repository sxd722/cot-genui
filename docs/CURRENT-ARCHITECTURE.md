# cot-genui 当前架构总览

> 架构快照：2026-08-21
> 主协议：ProfileDigest / ProfileView V2 → InferenceState → CardPlan → OpenUI Design Brief → OpenUI Lang v0.5
> 主链路：画像预处理 + 冻结的六步推理管线 + 首次生成后的编辑与学习闭环

本文描述当前项目的整体架构、关键产物、模块边界和安全约束。六步管线的逐字段、逐请求细节见 [CURRENT-PIPELINE.md](./CURRENT-PIPELINE.md)；较早的探索设计见 [DESIGN-DOC.md](./DESIGN-DOC.md)，不应作为当前实现的唯一依据。

---

## 1. 系统定位

cot-genui 是一个生成式 UI 探索项目：系统先把模糊请求转化为可解释、可校验的业务计划，再让 OpenUI 模型自由完成视觉表达。

当前设计遵循以下原则：

1. **CardPlan 是唯一业务 IR**：事实、卡片边界、数据来源和动作语义在此确定。
2. **OpenUI 只负责表达**：第⑥步不能重新发明事实、外链、动作或卡片数量。
3. **宽松创作，严格边界**：视觉布局允许模型发挥；shell、cardId、actionRef、assetRef 和原始 URL 受宿主校验。
4. **首次生成与学习解耦**：编辑和 Reflection 不进入首次生成关键路径。
5. **宿主拥有外部能力**：搜索、图片解析、动作执行和持久化都由宿主管理，OpenUI 不直接调用工具。
6. **可退化运行**：LLM、搜索或图片 provider 不可用时，系统保留诊断并尽可能继续展示安全结果。

---

## 2. 总体分层

```mermaid
flowchart TD
  U[用户输入与个人上下文]
  UI[React / Next.js 工作台]
  STORE[Zustand 会话状态]
  PROFILE[画像预处理与 ProfileView V2]
  ADAPT[本地分类与 Adaptive Policy]
  PIPE[六步推理管线]
  CP[CardPlan 业务 IR]
  MD[CardPlan Markdown]
  BRIEF[OpenUI Design Brief]
  ASSET[Host-owned Asset Resolver]
  OUI[OpenUI 生成与流式校验]
  RENDER[OpenUI React Renderer]
  EDIT[目标卡片局部编辑]
  LEARN[Episode / Reflection / Policy]
  IDB[(IndexedDB)]

  U --> UI --> STORE
  STORE --> PROFILE
  STORE --> ADAPT
  PROFILE --> PIPE
  ADAPT --> PIPE
  PIPE --> CP
  CP --> MD
  CP --> BRIEF
  CP --> ASSET
  BRIEF --> OUI
  ASSET --> OUI
  OUI --> RENDER
  RENDER --> EDIT
  EDIT --> LEARN
  LEARN --> IDB
  IDB --> ADAPT
```

### 2.1 前端工作台

- `src/app/page.tsx`：主页面布局。
- `src/components/InputPanel.tsx`：query、设备上下文、预设和模型选择。
- `src/components/workspace/InferencePane.tsx`：六步推理状态和调用诊断。
- `src/components/workspace/ResultPane.tsx`：CardPlan Markdown、CardPlan JSON、OpenUI 渲染和源码。
- `src/components/workspace/EditComposer.tsx`：目标卡片二次编辑、Undo/Redo 和 OK。
- `src/components/reflection/ReflectionOverlay.tsx`：归因、学习候选和 policy 管理。
- `src/store/useInferStore.ts`：浏览器端流程编排和主要会话状态。

### 2.2 服务端编排

- `src/app/api/infer/route.ts`：六步统一入口；第⑥步支持 SSE。
- `src/lib/pipeline.ts`：步骤协议、模型调用、归一化、工具路由、校验和 repair。
- `src/lib/pipelineTypes.ts`：跨步骤状态与输出类型。
- `src/lib/llm.ts` / `src/lib/modelProfiles.ts`：provider 和模型适配。
- `src/app/api/profile/*`：通用画像压缩。
- `src/app/api/prefetch-search/route.ts`：澄清暂停期间的搜索预取。

### 2.3 OpenUI 子系统

- `src/openui/payload.ts`：第⑥步最小载荷。
- `src/openui/bootstrap.ts`：确定性的 CardDeck required shell。
- `src/lib/openui.ts`：parser、结构覆盖、动作和 URL 安全校验。
- `src/openui/library.tsx`：完整运行时组件库。
- `src/openui/libraries/*`：用于系统提示词的 compact / expanded 组件面。
- `src/components/OpenUIRenderer.tsx`：流式解析、宿主动作和最终渲染。

---

## 3. 端到端主流程

```mermaid
flowchart LR
  P0[画像预处理]
  P1[① 意图建模]
  P2[② 证据解析]
  P3[③ 不确定性提问]
  WAIT[等待用户选择]
  P4[④ 总结与能力补齐]
  P5[⑤ CardPlan 生成]
  A[图片资源解析]
  P6[⑥ OpenUI 生成]
  V[Parser / Coverage / Safety]
  FIX[一次定向 Repair]
  VIEW[流式/最终渲染]

  P0 --> P1 --> P2 --> P3
  P3 -->|有阻塞问题| WAIT --> P4
  P3 -->|无需提问| P4
  P4 --> P5
  P5 --> A
  P5 --> P6
  A --> P6
  P6 --> V
  V -->|通过| VIEW
  V -->|失败| FIX --> V
```

### 3.1 阶段 0：通用画像

结构化 `deviceContext` 或自由文本画像先压缩为 query-independent `ProfileDigest`。第一步再根据当前 query 生成固定预算的 `ProfileViewV2`：

- 默认硬上限 6,000 字符；
- 不超过旧 ProfileDigest 字符预算；
- 只暴露稳定核心、领域目录和当前任务相关证据；
- 画像压缩结果缓存在当前 Next.js 服务进程内，重启后失效。

### 3.2 六步管线

| 步骤 | 主要职责 | 关键输出 |
|---|---|---|
| ① 意图建模 | 定义任务、交付等级、槽位需求和检索请求 | `InferenceState`、`slotRequirements` |
| ② 证据解析 | 从原始上下文按需检索证据、填槽和识别冲突 | `slots`、`conflicts` |
| ③ 不确定性提问 | 只询问阻塞最终决策的关键不确定项 | 2–4 选项的最小问题集 |
| ④ 总结与能力补齐 | 写回用户答案，按需进行宿主联网搜索 | `summary`、可选 `webFacts` |
| ⑤ CardPlan 生成 | 决定 1–6 张卡片的业务拓扑、数据、动作和表达意图 | `CardPlan` |
| ⑥ OpenUI 生成 | 根据 Markdown brief 和 required shell 生成视觉程序 | `openuiCode`、diagnostics |

六步顺序固定，但每一步可独立选择模型。默认均为 Groq Qwen3.6-27B。⑤使用较低但非零的采样，让模型按任务边界选择信息拓扑；简单任务仍可只生成一张卡。

### 3.3 暂停与继续

如果③产生未回答问题，“一键全部”在此暂停。暂停期间前端可预取④需要的搜索结果；用户回答后继续执行④–⑥。搜索词不一致、缓存过期或预取失败时，④回退到即时搜索。

---

## 4. 核心产物与边界

| 产物 | 产生位置 | 性质 | 消费者 |
|---|---|---|---|
| `ProfileDigest` | 画像 API | 可复用用户画像摘要 | ProfileView Builder |
| `ProfileViewV2` | ①之前确定性构建 | query-aware、固定预算投影 | ①模型 |
| `InferenceState` | ①–④累积 | 任务事实、槽位、冲突、问题和搜索证据 | ⑤模型 |
| `CardPlan` | ⑤模型 + 服务端 normalize | 唯一业务 IR 和动作事实源 | Markdown、shell、validator、编辑器 |
| `CardPlan Markdown` | CardPlan 确定性派生 | 高容错、供人阅读的文本投影 | 调试视图、编辑与学习上下文 |
| `OpenUI Design Brief` | CardPlan + safe asset refs 确定性派生 | ⑥模型专用、内容与设计元数据分流 | ⑥模型、leakage validator |
| `requiredShell` | CardPlan 确定性派生 | 固定 CardDeck、cardId、顺序和 body ref | ⑥模型、repair |
| `AssetManifest` | ⑥之前由宿主解析 | 已验证 asset ID 到真实 URL 的映射 | safe refs、validator、AssetRegistry |
| `OpenUI Lang` | ⑥模型 | 可流式解析的视觉程序 | validator、React Renderer、局部编辑 |
| `GenerationEpisode` | 首次生成与编辑过程中 | 脱敏、紧凑的学习记录 | IndexedDB、Reflection |

### 4.1 CardPlan

CardPlan 包含：

- `skillName / reasoning`；
- 1–6 个 `cards`；
- 每张卡的稳定 `id / purpose`；
- 事实 block、可选 presentation intent 和 action；
- 证据槽位引用；
- 可选、只描述需求而不包含 URL 的 `assetRequest`。

服务端会修复缺失或重复 ID、归一化 block、过滤非法动作和不在宿主 allowlist 中的外链。CardPlan JSON 保留为内部安全事实源和调试视图。

### 4.2 CardPlan Markdown

CardPlan Markdown 不是第二个模型产物，而是 CardPlan 的唯一文本投影：

- 使用语义化 Markdown，不再混入 YAML；
- 每张卡的 `title` 是不超过 10 个字的展示概括；完整 `purpose` 作为“主题”放在“感觉与节奏”中；旧 CardPlan 没有 title 时由宿主从 purpose 确定性派生；
- 描述整体 vibe、每张卡的目标、数据和动作；
- 数据和动作在每张卡 section 末尾集中列出；
- 只列出宿主已经接受的 `assetRef`，不包含图片 URL；
- 保留给人类/debug UI 阅读，不再作为⑥模型的生成协议。

### 4.3 第⑥步载荷

首次生成 user payload 固定为：

```ts
{
  requiredShell,
  designBrief: {
    cards: [{
      id,
      purpose,
      renderableContent,
      designIntent,
      availableAssets,
      actions,
    }],
  },
}
```

`renderableContent` 是唯一允许复制或转述为可见 UI 的文本来源；`designIntent` 只包含受限枚举，是 NON-RENDERABLE 元数据。CardPlan Markdown、CardPlan JSON、action bindings 和 acceptance 不重复进入模型上下文。若首次结果校验失败，repair 只接收 required shell、当前源码、错误和缺失引用，不重复发送 design brief。

---

## 5. OpenUI 生成与渲染

### 5.1 Prompt 路由

系统提示词根据模型能力选择组件面：

- **compact**：Qwen 27B、HF Qwen3.8-27B、DiffusionGemma、GLM Flash；
- **expanded**：GPT-OSS-120B、GLM-5.2、GLM-5.2 Thinking。

compact 继续按 general / planning / recommendation / analysis 任务族选择高价值组件。系统提示词只是生成能力面；浏览器 renderer 始终加载完整官方 OpenUI runtime library。

### 5.2 流式协议

`POST /api/infer` 在 `openui_generate + stream=true` 时返回 SSE：

- `delta`：追加模型源码并交给 OpenUI renderer 渐进解析；
- `done`：返回最终源码、manifest、usage、timing 和 diagnostics；
- `error`：返回可展示错误，不把半成品写成最终版本。

前端记录 request、首 delta、首个可渲染 root 和 done 的相对时间。

### 5.3 校验与 repair

最终 OpenUI 必须满足：

- root 是 `CardDeck`；
- 直接子节点只能是 `GeneratedCard`；
- 卡片数量、顺序和 cardId 与 CardPlan 一致；
- 每个 CardPlan actionRef 恰好出现一次；
- 无 unresolved、截断或 parser error；orphaned statements 会进入 diagnostics；
- 不使用 Query、Mutation、`@Run`、`@OpenUrl`；
- 源码不出现原始 `http(s)`；
- `AssetImage/AssetGallery` 只能引用 manifest 中存在的 ID。
- 不把 `designIntent` 字段、Vibe 标题、Card ID 标签或作者指导语渲染成可见文案。

首次结果不合法时，系统使用同 provider 的非 Thinking 模型定向 repair 一次；第二次仍失败则结束本步骤并返回明确错误。

### 5.4 宿主动作

OpenUI action 通过 `plan:<cardId>:<actionId>` 引用 CardPlan：

- renderer 在宿主侧解析并查回 CardPlan action；
- 未绑定动作被拦截；
- external-link 再执行 http(s) 校验后由宿主打开；
- copy、navigate 等由 React host 处理；
- `toolProvider` 始终为 `null`；
- `OPENUI_LOCAL_BINDINGS` 默认关闭。

---

## 6. Host-owned 图片架构

图片链路在⑥模型调用前运行：

```text
assetRequest
  → collectAssetRequests
  → resolveAssetManifest
  → ImageSearchProvider
  → candidate runtime parsing
  → HTTPS / DNS / SSRF / redirect validation
  → AssetManifest
  → safeAssetRefs
  → OpenUI Design Brief.availableAssets
  → AssetImage(assetRef) / AssetGallery(assetRefs)
  → AssetRegistryProvider
  → <img src={hostValidatedUrl}>
```

### 6.1 Provider 状态

`AssetResolutionDiagnostics.providerState` 显式区分：

- `disabled`：feature flag 关闭；
- `noop-unconfigured`：没有配置 provider，使用 Noop fallback；
- `configured`：provider 已配置，但本次没有请求；
- `provider-error`：请求、HTTP 或响应协议失败；
- `zero-results`：请求成功但没有候选；
- `validation-rejected`：有候选但全部未通过校验；
- `ready`：至少一个候选被接受。

diagnostics 同时记录 requests、candidates、accepted、rejected，以及每个 provider error 或 rejected candidate 的 `stage + reason`。它进入 Step 6 outputs、`openuiDiagnostics` 和调用日志；开发模式下在 OpenUI 渲染器底部可展开查看。

### 6.2 自定义 provider 契约

当前提供严格的 `custom-http-v1` adapter：

```text
POST IMAGE_SEARCH_API_URL
Authorization: Bearer IMAGE_SEARCH_API_KEY
Content-Type: application/json

Request:  { query, limit }
Response: { schemaVersion: "1", results: [{ imageUrl, sourceUrl?, alt? }] }
```

系统不会猜测任意第三方 API 的字段。未配置 endpoint 时，Noop provider 只负责优雅降级。

### 6.3 URL 安全

候选图片必须：

- 使用 HTTPS 且不携带 URL credentials；
- hostname 和 DNS 结果均不是本地、私网、保留地址或 IPv4-mapped 私网地址；
- 每次 redirect 都重新进行 URL 与 DNS 安全检查；
- 最多重定向 3 次；
- HEAD 返回图片 Content-Type 时直接接受；
- HEAD 不支持、403/405/501 或缺少 Content-Type 时，使用 `Range: bytes=0-1023` 的有界 GET；
- GET 后立即取消未消费 body，避免下载整张图片。

Manifest 中真实 URL 会发送给浏览器中的 AssetRegistry 用于实际显示，但不会进入第⑥步模型 payload 或 OpenUI 源码。

---

## 7. 首次生成后的卡片编辑

卡片编辑不重跑六步：

1. 用户进入一次性 targeting mode；
2. 前端记录 cardId、相对/像素坐标、附近文字和 element hint；
3. `POST /api/openui/edit` 提取目标 card body 的 dependency closure；
4. 模型只返回 assignment statement patch；
5. 服务端禁止修改 shell、共享或目标闭包外的 statement；
6. patch 合并后重新执行整份 OpenUI 校验；
7. 成功后替换当前版本，并支持 Undo/Redo。

二次编辑只允许 GLM-5.2 和 GLM-4.7-Flash。当前编辑 API 不接收 `AssetManifest`，因此首次生成中的 assetRef allowlist 校验没有完整延伸到编辑请求；本轮资产改造按约束没有修改卡片编辑协议。

---

## 8. Adaptive Learning 与 Reflection

Adaptive Layer 位于六步外围，不改变六步协议：

- 本地启发式 query 分类，零 LLM 调用；
- policy 按 global → class → user-class 选择；
- Step 1 使用固定预算 ProfileView V2；
- 每一步最多注入一条 steering hint；
- provenance 记录 policy version、实际 hint、输入输出摘要和证据关系。

用户点击 OK 后：

1. 当前 `GenerationEpisode` 写入 IndexedDB；
2. Reflection 异步判断信息首次丢失或偏移的位置；
3. Attribution 和 textual gradient 固定使用 GLM-5.2 Thinking；
4. candidate 只能修改 `profileOverlay` 或某一步的单句 hint；
5. 默认人工 Apply / Discard；guarded-auto 默认关闭；
6. policy 支持版本回退。

Reflection 不读取 provider 隐藏思维链，不允许改变 schema、工具、模型选择或步骤结构。

---

## 9. 状态、缓存与持久化

### 9.1 Zustand 会话状态

浏览器主状态包括：

- query、设备上下文和画像状态；
- 六步状态、日志、模型、token、费用和 timing；
- `InferenceState / CardPlan / cardPlanMarkdown`；
- `openuiCode / assetManifest / openuiDiagnostics`；
- OpenUI 流式时间点；
- targeting、编辑草稿和 OpenUI versions；
- episode、reflection、policy 和学习设置。

### 9.2 缓存

- 画像压缩：Next.js 服务进程内 `Map`；
- 六步结果：浏览器模块级小型 LRU；
- 搜索预取：浏览器内短期缓存，按搜索词匹配；
- OpenUI specs：构建时由 OpenUI CLI 确定性生成并提交到仓库。

### 9.3 IndexedDB

数据库 `cot-genui-learning` 包含：

- `episodes`；
- `policies`；
- `policyObservations`；
- `settings`。

学习数据保留在用户浏览器，不持久化完整 deviceContext。

---

## 10. 模型与 Provider

当前可选模型：

| Profile | Provider | 典型用途 |
|---|---|---|
| Groq Qwen3.6-27B | Groq | 六步默认、低时延 |
| Groq GPT-OSS-120B | Groq | 较强推理、expanded OpenUI prompt |
| HF Community Qwen3.8-27B | 临时 OpenAI-compatible endpoint | 无 key 实验路径 |
| NVIDIA DiffusionGemma-26B | NVIDIA Build | 文本推理实验，不声明工具 |
| GLM-5.2 Thinking | GLM | 长上下文推理、Reflection |
| GLM-5.2 | GLM | OpenUI、编辑、repair |
| GLM-4.7-Flash | GLM | 快速编辑和低成本路径 |

联网搜索和图片搜索都由宿主编排。④可由服务端按 provider 能力挂载 web search；第⑥步 OpenUI 模型不接收搜索或图片工具。图片解析由独立 ImageSearchProvider 管理。

---

## 11. Feature Flags

| Flag | 默认值 | 作用 |
|---|---:|---|
| `ADAPTIVE_QUERY_CLASSIFICATION` | on | 本地任务分类 |
| `ADAPTIVE_STEERING` | on | 每步单句 steering |
| `PROFILE_VIEW_V2` | on | 固定预算画像投影 |
| `WEB_FACTS_OPTIONAL` | on | web facts 作为可选证据 |
| `OPENUI_CARD_EDIT` | on | 卡片局部编辑 |
| `OPENUI_ASSETS` | on | host-owned 图片解析 |
| `OPENUI_LOCAL_BINDINGS` | off | 实验性本地交互绑定 |
| `REFLECTION_ATTRIBUTION` | on | OK 后异步归因 |
| `REFLECTION_GRADIENT` | on | 生成 textual gradient candidate |
| `GUARDED_AUTO_LEARN` | off | 满足阈值后的自动晋升 |

Flags 使用 `NEXT_PUBLIC_*` 环境变量读取。关闭学习相关 flag 时，首次六步生成仍可独立运行。

---

## 12. API 边界

| API | 职责 |
|---|---|
| `/api/profile/compress` | 结构化画像压缩 |
| `/api/profile/compress-free-text` | 自由文本画像压缩 |
| `/api/infer` | 六步统一执行；⑥支持 SSE |
| `/api/prefetch-search` | 暂停期间搜索预取 |
| `/api/search` | 隔离的搜索能力入口 |
| `/api/openui/edit` | 目标卡片局部 patch |
| `/api/reflection/attribute` | Episode 阶段归因 |
| `/api/reflection/gradient` | 受约束学习候选 |
| `/api/llm` | 兼容/开发用途的通用 LLM 入口 |

所有密钥只在服务端环境变量中读取。`IMAGE_SEARCH_API_KEY`、Groq、GLM 和 NVIDIA key 不进入客户端 bundle。

---

## 13. 生产主链与遗留隔离区

当前生产工作台只保留四个结果视图：

1. CardPlan Markdown；
2. CardPlan JSON；
3. OpenUI 渲染；
4. OpenUI 源码。

以下代码仍保留用于历史探索或隔离开发，但不在当前生产六步主链中：

- `/dsl-demo`；
- `src/components/dsl/*`；
- `A2UIRenderer`、`StackedCards` 等早期展示组件；
- DSL compiler / reducer / tool executor 等实验模块。

它们不应重新接回主链，除非有单独的迁移设计和验收计划。

---

## 14. 当前已知边界

1. 未配置 `IMAGE_SEARCH_API_URL` 时，真实图片不会出现，状态为 `noop-unconfigured`。
2. 图片 provider 使用项目自定义 v1 contract；第三方 API 需要代理或单独 adapter。
3. 图片 URL 在首次解析时验证，但远端资源之后仍可能过期或撤回。
4. 真实图片 smoke test 只在 URL 和 key 均存在时执行；Mock pipeline 不代表真实 provider 可用。
5. 画像缓存是进程内缓存，不适合多实例共享。
6. 学习数据存于单浏览器 IndexedDB，没有跨设备同步。
7. Card edit 尚未携带 AssetManifest，编辑路径的 assetRef allowlist 不是端到端完整状态。
8. HF Community endpoint 和免费 provider 可能限流、冷启动或下线。
9. Reflection 和首次生成共享同一应用，但在时序和数据协议上保持异步隔离。

---

## 15. 验证命令

```bash
npm run generate:openui
npm test
npm run lint
npm run build
```

图片 provider 凭据存在时可额外运行：

```bash
npx vitest run tests/openui/asset-provider.smoke.test.ts
```

首次生成质量评估：

```bash
npx tsx scripts/eval-openui-generation.ts --model glm_5_2 --out glm52-openui-eval.json
```

---

## 16. 一句话总结

当前架构以 **CardPlan 作为业务事实源、OpenUI 作为受控视觉生成层、宿主作为数据/动作/图片/安全能力所有者**，并在首次生成之外叠加可回滚的局部编辑和异步自适应学习。
