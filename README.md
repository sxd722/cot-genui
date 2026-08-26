# cot-genui · 意图消歧 CoT 可视化调试工具

面对用户模糊意图（如"帮我规划去北京旅游"），LLM 如何结合设备使用记录等本地上下文，**推断出用户真实诉求**？

本工具把"推断过程"本身可视化：展示模型如何走一条**可解释的 7 步消歧管线**——从表层解析、上下文挖掘、冲突检测，到最小化提问与方案生成。

## 核心方法论：7 步消歧管线

```
模糊 query
  → [1] 表层解析(抽 verb + 缺失槽位)
  → [2] 充分性判定
  → [3] 上下文挖掘(每槽位→证据→置信度)
  → [4] 冲突检测(多源证据是否矛盾)
  → [5] 分流(高置信采纳 / 低置信+冲突→提问)
  → [6] 最小化提问(只问卡住关键决策的)
  → [7] 生成(推断摘要 + 结果 + 假设清单)
```

**三条铁律**：① 能推断的不问 ② 推断必带证据 ③ 冲突优先问。

## 快速开始

```bash
npm install
npm run dev
# 打开 http://localhost:3000
```

> 即使不配置 LLM，工具也会以 **mock 模式**运行（返回样例推理结果），方便独立调试 UI 与可视化。

## 首次生成质量开发

首次生成现在由 CardPlan topology、受限 presentation intent、模型/任务感知 OpenUI palette、宿主媒体注册表和安全局部交互共同驱动。小模型使用 16–22 个高价值组件的 compact prompt，大模型使用 expanded prompt；renderer 始终保留完整运行时组件库。

第⑥步不再把供人阅读的 CardPlan Markdown 当作模型协议。宿主从 CardPlan 确定性构建 `designBrief`：只有 `renderableContent` 可以成为可见文案，`designIntent` 只是 NON-RENDERABLE 的组件、层级、密度和强调提示；媒体与动作分别只暴露 `assetRef` 和 `actionRef`。生成后 validator 会拦截设计字段、Vibe 标题或作者指导语泄漏，并沿现有 repair 路径清理。

静态回归命令：

```bash
npm run generate:openui
npm test
npm run lint
npm run build
```

需要本地服务和 provider 凭据的可选评估：

```bash
npx tsx scripts/eval-openui-generation.ts --model groq_qwen_3_6_27b --out qwen27b-openui-eval.json
npx tsx scripts/eval-openui-generation.ts --model glm_5_2 --out glm52-openui-eval.json
# Provider 中断后只重试失败项；仅允许复用同一模型的成功结果
npx tsx scripts/eval-openui-generation.ts --model glm_5_2 --resume glm52-openui-eval.json --out glm52-openui-eval.json
```

评估固定覆盖 24 个 information / recommendation / planning / decision / analysis / creation / action / support 场景，并输出三卡率、简单任务单卡率、组件多样性、primitive ratio、媒体覆盖、repair rate、prompt tokens 与 Time-to-Valid-UI。

2026-08-19 本地开发服务实测（provider 延迟与配额会影响结果）：

| 模型 | 完成度 | Prompt profile | 三卡率 | 组件中位数 | Primitive ratio | Repair rate | Step 6 tokens 中位数（prompt + completion） | Time-to-Valid-UI 中位数 |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| GLM-5.2 | 24/24 | `expanded:general` | 12.5% | 11 | 41.7% | 4.2% | 4,185 + 629 | 7,177 ms |
| Qwen 27B / Groq | 7/24（TPD 配额中断） | task-routed `compact:*` | 0% | 7 | 33.3% | 0% | 3,113 + 492 | 27,098 ms |

GLM 在旧版 1–6 卡评估集上的协议有效率为 100%，简单单目标单卡率为 100%，媒体型 fixture 的 `assetRequest` 覆盖为 100%，repair 后无无效产物。当前 CardPlan 卡片数量已不设固定上限。Qwen 行只是配额中断前的部分观测，且早于最终媒体提示词收紧，不能作为完整模型对比或最终验收结论；未捕获同 provider 的改造前 live baseline，因此不虚构增量数据，compact prompt 相对 full-library baseline 的缩减由静态回归测试约束。

## Host-owned 图片解析

图片检索完全由宿主在第⑥步模型调用前完成：`assetRequest → resolveAssetManifest → image provider → HTTPS/SSRF/DNS/redirect 校验 → safeAssetRefs → OpenUI → AssetImage/AssetGallery → AssetRegistry`。OpenUI 模型只能看到已接受的 `assetRef` ID，看不到图片 URL，也不能调用图片工具；源码中的原始 `http(s)` 仍会被 validator 拒绝。

图片现在由 CardPlan 显式驱动：第⑤步会为媒体内容声明 query、role 与 `wide | square | portrait` 画幅；若模型在明确图片意图或 media 卡中漏写请求，宿主会在不增加 LLM 调用、不改变卡片数量的前提下最多确定性补两个请求。CardPlan Markdown 会显示请求 ID、主题、用途、画幅、数量和解析状态。第⑥步只强制采用真正通过宿主校验的请求；无候选或 provider 失败时仍降级为纯内容卡片。

在 Clash/Mihomo 等 TUN fake-IP 环境中，系统 DNS 可能把公网图片域名映射到 `198.18.0.0/15`。默认 `IMAGE_DNS_VALIDATION_MODE=system` 会继续安全拒绝；可显式改为 `doh-fallback` 并配置 `IMAGE_DNS_DOH_URL=https://cloudflare-dns.com/dns-query`。DoH 只在系统结果全部属于该 fake-IP 网段时启用，DoH 返回私网地址、IP 字面量、非 HTTPS URL 与不安全重定向仍会被拒绝。

### 图片 Provider 链

Provider 按以下顺序回退——前一个请求失败或未产出可接受资产时自动尝试下一个：

| 顺序 | Provider | 配置 | 说明 |
|---|---|---|---|
| 1 | `custom-http-v1` | `IMAGE_SEARCH_API_URL` + `IMAGE_SEARCH_API_KEY` | 显式配置的自定义端点，契约见下 |
| 2 | Pexels | `PEXELS_API_KEY` | 推荐的免费 provider（视觉质量优先），https://www.pexels.com/api/ |
| 3 | Openverse | 默认开启，`OPENVERSE_IMAGES=off` 关闭 | 无需 key 的开放授权兜底 |
| 4 | Noop | 前三者均不可用 | 只负责优雅降级，`providerState=noop-unconfigured` |

在 `.env.local` 中配置（全部可选）：

```bash
NEXT_PUBLIC_OPENUI_ASSETS=true
NEXT_PUBLIC_SKILL_REUSE=true

# 推荐主 provider（免费申请 key）
PEXELS_API_KEY=

# 无 key 兜底（默认 on）
OPENVERSE_IMAGES=on

# 可选自定义端点（显式配置时优先级最高）
IMAGE_SEARCH_API_URL=https://your-image-proxy.example/v1/search
IMAGE_SEARCH_API_KEY=your-server-only-key
IMAGE_SEARCH_TIMEOUT_MS=5000
```

### Skill 匹配模型

Skill 复用默认使用 Groq 上的 Qwen 27B，也可在输入面板切换为 GLM-5.2。系统先独立把 `去北京旅游` 抽象为 `旅游(destination=北京)`，再用不含具体值的通用意图检索最多 24 个脱敏 Skill 索引并完成匹配。SkillRecipe v3 只保存 `旅游(destination)`；北京、西安等值仅保留在当前私有 TaskRun，不进入分享包。

匹配详情可展开查看参数映射、结构化依据、冲突、逐步复用计划、耗时和 token。这里展示的是经 schema 校验的模型决策 JSON，不包含或持久化模型私有 CoT。第二阶段发给匹配模型的 abstraction 会移除北京、西安等参数值；请求不会发送完整 recipe、设备上下文原文、历史具体值、图片 URL、OpenUI 源码或本地候选分数。模型独立给出语义分；本地评分只用于最多 24 个候选的预筛。历史 Skill 布局由当前任务布局覆盖，不阻止通用流程复用。当前 query 已明确提供的参数必须可靠映射；Skill 尚未获得值的必填参数会作为“待补参数”进入证据解析或澄清，不阻止匹配与确定性意图复用。抽象、匹配或自动应用门槛失败时，面板会显示结构化调试日志；本地结果只作为人工候选，不会自动应用。

Skill 命中后，每个步骤的展开区会显示本步复用了什么、是否跳过模型调用、回退原因、投影字段，以及实际加入 system prompt 的 Skill 结构先验。最终卡片下方还可记录“整体卡片流反馈”；反馈会写入私有 GenerationEpisode，在用户接受结果后交给 Reflection 参考，但不会立即修改当前 CardPlan 或 OpenUI。有整体反馈的运行不会作为零干预样例自动发布 Skill。

`IMAGE_SEARCH_API_URL` 是明确的 `custom-http-v1` 适配器契约，不是任意图片 API 地址。宿主发送：

```json
{
  "query": "北京海淀区酒店外观",
  "limit": 2
}
```

端点必须返回：

```json
{
  "schemaVersion": "1",
  "results": [
    {
      "imageUrl": "https://public-cdn.example/hotel.jpg",
      "sourceUrl": "https://example.com/hotel",
      "alt": "酒店外观"
    }
  ]
}
```

请求使用 `POST application/json`；配置 key 时发送 `Authorization: Bearer <IMAGE_SEARCH_API_KEY>`。Pexels/Openverse 的署名信息（creator/license）保存在宿主 `AssetRecord` 中，不进入模型载荷。

响应结构不匹配、provider 异常、零结果或 URL 校验失败都会优雅降级，并在开发模式 OpenUI 底部显示 `disabled / noop-unconfigured / configured / provider-error / zero-results / validation-rejected / ready`、计数、`providersTried` 和带 provider 标注的拒绝原因。图片 URL 必须为公网 HTTPS；校验先尝试 HEAD，在 403/405、不支持 HEAD 或缺少 Content-Type 时，以 `Range: bytes=0-1023` 做有界 GET 回退，并对每次重定向重新执行 DNS/SSRF 校验。

### 本地 Image Gateway

仓库内置 `services/image-gateway`，用于在本地统一 Openverse、Pexels 和可选 SearXNG，并输出上面的 `custom-http-v1` 契约。Gateway 只执行搜索和字段归一化；返回的候选图片仍由 `resolveAssetManifest` 完成公网 HTTPS、SSRF、DNS、redirect 和 MIME 校验，不会绕过宿主安全边界。

最小 Openverse 配置：

```bash
# Image Gateway 自身
IMAGE_GATEWAY_HOST=127.0.0.1
IMAGE_GATEWAY_PORT=4010
IMAGE_GATEWAY_API_KEY=local-dev
IMAGE_GATEWAY_PROVIDERS=openverse

# cot-genui 通过 custom-http-v1 调用本地 Gateway
IMAGE_SEARCH_API_URL=http://127.0.0.1:4010/v1/search
IMAGE_SEARCH_API_KEY=local-dev
```

启动 Gateway：

```bash
npm run dev:image-gateway
```

另一个终端启动主应用。也可以不启动常驻服务，直接运行一次真实 Openverse 端到端演示；脚本会启动临时 Gateway，并将候选继续送入现有 URL validator：

```bash
npm run demo:image-gateway:openverse
# 自定义语义查询
npm run demo:image-gateway:openverse -- "京都秋日寺庙建筑"
```

演示脚本仅在 URL 安全校验阶段使用独立公共 DNS 查询，以兼容把公网域名映射到 `198.18.0.0/15` 的本地 VPN/TUN fake-IP 环境；主应用默认 DNS/SSRF 策略保持不变。如果主应用诊断显示公共图片域名被解析到该网段，应优先在本地代理中把图片 CDN 加入 fake-IP bypass，而不是放宽应用的私网地址规则。

Gateway 提供 `GET /health`，返回当前实际启用的 provider。`IMAGE_GATEWAY_PROVIDERS` 控制回退顺序，支持 `pexels,openverse,searxng`；Pexels 需要 `IMAGE_GATEWAY_PEXELS_API_KEY`（未设置时兼容读取 `PEXELS_API_KEY`），SearXNG 需要 `IMAGE_GATEWAY_SEARXNG_URL`，并且实例必须启用 JSON 输出格式。Gateway 在响应头中返回 `X-Image-Provider` 和 `X-Image-Provider-Attempts`，便于定位 provider error、zero results 和最终命中来源。

注意：本地 Gateway 返回的 `imageUrl` 应当仍是公网 HTTPS 图片。不要把 `http://localhost/...` 图片地址作为搜索候选返回；它会被 SSRF 校验正确拒绝。若需要把图片下载并从本机稳定展示，应在 URL 校验之后增加独立的宿主物化/缓存层。

真实端点 smoke test 仅在配置了 `PEXELS_API_KEY` 或 `IMAGE_SEARCH_API_URL` + `IMAGE_SEARCH_API_KEY` 时运行（Openverse 不作为 smoke 触发条件，保证 `npm test` 不触网）：

```bash
npm run smoke:openui-assets
```

成功链路的开发诊断示例：

```json
{
  "providerState": "ready",
  "requests": 1,
  "candidates": 2,
  "accepted": 1,
  "rejected": 1,
  "events": [
    { "stage": "head", "requestId": "asset_hotel_1", "candidateIndex": 1, "reason": "HEAD content-type is not an image: text/html" }
  ]
}
```

只有接受后的 ID 会进入模型上下文和 OpenUI artifact：

```text
image = AssetImage("asset_hotel_1", "酒店外观", "wide")
```

## 接入真实 LLM

复制 `.env.example` 为 `.env.local`，填入兼容 OpenAI 接口的凭据：

```bash
LLM_API_KEY=sk-...
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4   # 可选，指向 GLM/DeepSeek 等
LLM_MODEL=glm-4-plus                                  # 可选
```

模型通过 **Structured Outputs**（`response_format: json_schema`）强制输出带 `steps / slots / conflicts / clarifying_questions / result` 的结构化推理。

## 界面布局

```
┌─────────────┬──────────────────────┬─────────────────┐
│  输入区      │   CoT 推理可视化      │   结构化结果     │
│ · query      │  7 步推理卡片(可折叠)  │  推断画像        │
│ · 设备上下文  │  槽位表(置信度色条)    │  行程方案        │
│   +预设场景   │  冲突 / 消歧问题       │  假设清单(可纠正) │
└─────────────┴──────────────────────┴─────────────────┘
```

内置三个预设设备上下文场景：
- **杭州上班族** — 年假已定，搜索记录含"亲子游"（与通讯录无亲子标签构成冲突）
- **带娃家庭** — 三口之家，信号一致
- **极简上下文** — 信息严重不足，验证提问步骤是否被正确触发

## 项目结构

```
src/
├── app/
│   ├── page.tsx              # 三栏主页面
│   └── api/infer/route.ts    # 调用 LLM 的 API route
├── components/
│   ├── InputPanel.tsx        # 左：query + 上下文编辑 + 预设
│   ├── CotTrace.tsx          # 中：7 步推理 + 槽位/冲突/提问
│   ├── SlotTable.tsx         # 槽位表(置信度色条)
│   └── ResultPanel.tsx       # 右：结构化结果
├── lib/
│   ├── llm.ts                # LLM 客户端 + mock
│   ├── schemas.ts            # 输出 JSON Schema
│   └── presets.ts            # 预设设备上下文
├── prompts/
│   ├── system.md             # 意图消歧专家 system prompt
│   └── slots-travel.ts       # 旅游场景槽位定义
└── store/useInferStore.ts    # Zustand 状态
```

## 如何泛化到其他场景

管线本身与"旅游"无关。`src/prompts/slots-travel.ts` 定义了旅游场景的槽位（出行人/出发地/日期/预算/…）。
**换一份 slot schema**，即可把同一管线应用到"点外卖""买礼物""订会议室"等其他模糊意图——这是工具设计上的核心扩展点。
