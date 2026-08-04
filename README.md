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
