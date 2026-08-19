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

GLM 完整结果的 1–6 卡协议有效率为 100%，简单单目标单卡率为 100%，媒体型 fixture 的 `assetRequest` 覆盖为 100%，repair 后无无效产物。Qwen 行只是配额中断前的部分观测，且早于最终媒体提示词收紧，不能作为完整模型对比或最终验收结论；未捕获同 provider 的改造前 live baseline，因此不虚构增量数据，compact prompt 相对 full-library baseline 的缩减由静态回归测试约束。

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
