"use client";

import { useMemo, useState } from "react";
import { useInferStore } from "@/store/useInferStore";
import type { InferPlanCard, CardMetric, CardTimelineNode } from "@/lib/schemas";
import { toText, toTextInline } from "@/lib/format";

/* ----------------------- 主题 ----------------------- */
type Theme = {
  name: string;
  emoji: string;
  gradients: string[];
  accent: string;
  glow: string;
};

const THEMES: Record<string, Theme> = {
  trip: {
    name: "旅行",
    emoji: "🧭",
    gradients: [
      "from-sky-400 via-cyan-500 to-blue-600",
      "from-teal-400 via-emerald-500 to-cyan-600",
      "from-indigo-400 via-blue-500 to-purple-600",
      "from-cyan-400 via-sky-500 to-indigo-600",
      "from-blue-400 via-indigo-500 to-purple-600",
      "from-emerald-400 via-teal-500 to-cyan-600",
      "from-violet-400 via-purple-500 to-fuchsia-600",
      "from-sky-500 via-blue-600 to-indigo-700",
    ],
    accent: "text-cyan-100",
    glow: "shadow-cyan-500/40",
  },
  food: {
    name: "美食",
    emoji: "🍜",
    gradients: [
      "from-amber-400 via-orange-500 to-red-500",
      "from-orange-400 via-red-500 to-rose-600",
      "from-yellow-400 via-amber-500 to-orange-600",
      "from-red-400 via-rose-500 to-pink-600",
      "from-amber-500 via-orange-600 to-red-600",
      "from-orange-400 via-amber-500 to-yellow-600",
      "from-rose-400 via-red-500 to-orange-600",
      "from-red-500 via-rose-600 to-pink-700",
    ],
    accent: "text-amber-100",
    glow: "shadow-orange-500/40",
  },
  shopping: {
    name: "购物",
    emoji: "🛍️",
    gradients: [
      "from-fuchsia-400 via-purple-500 to-indigo-600",
      "from-pink-400 via-rose-500 to-fuchsia-600",
      "from-purple-400 via-violet-500 to-indigo-600",
      "from-violet-400 via-purple-500 to-fuchsia-600",
      "from-rose-400 via-pink-500 to-purple-600",
      "from-purple-500 via-fuchsia-600 to-pink-600",
      "from-indigo-400 via-purple-500 to-fuchsia-600",
      "from-fuchsia-500 via-purple-600 to-indigo-700",
    ],
    accent: "text-fuchsia-100",
    glow: "shadow-fuchsia-500/40",
  },
};

const DEFAULT_THEME: Theme = {
  name: "方案",
  emoji: "✨",
  gradients: [
    "from-slate-500 via-zinc-600 to-stone-700",
    "from-zinc-500 via-slate-600 to-gray-700",
    "from-stone-500 via-zinc-600 to-slate-700",
    "from-gray-500 via-stone-600 to-zinc-700",
    "from-slate-600 via-gray-700 to-stone-800",
    "from-zinc-600 via-slate-700 to-gray-800",
    "from-stone-600 via-zinc-700 to-slate-800",
    "from-gray-600 via-stone-700 to-zinc-800",
  ],
  accent: "text-zinc-100",
  glow: "shadow-zinc-500/40",
};

function pickTheme(taskType: unknown): Theme {
  const t = toText(taskType).toLowerCase();
  if (t.includes("trip") || t.includes("travel") || t.includes("旅")) return THEMES.trip;
  if (t.includes("food") || t.includes("order") || t.includes("餐") || t.includes("食"))
    return THEMES.food;
  if (t.includes("shop") || t.includes("buy") || t.includes("购")) return THEMES.shopping;
  return DEFAULT_THEME;
}

/* ----------------------- 图形化子组件 ----------------------- */

/** 可勾选清单 */
function CheckList({ items }: { items: string[] }) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {items.map((it, i) => {
        const on = !!checked[i];
        return (
          <li key={i}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setChecked((c) => ({ ...c, [i]: !c[i] }));
              }}
              className="flex w-full items-start gap-1.5 text-left"
            >
              <span
                className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] ${
                  on
                    ? "border-white bg-white text-emerald-600"
                    : "border-white/50 text-transparent"
                }`}
              >
                ✓
              </span>
              <span
                className={`text-[11px] leading-snug transition-all ${
                  on ? "text-white/50 line-through" : "text-white/95"
                }`}
              >
                {toText(it)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 数值指标条（预算等） */
function MetricBars({ metrics }: { metrics: CardMetric[] }) {
  const max = Math.max(...metrics.map((m) => m.value), 1);
  const total = metrics.reduce((s, m) => s + (m.value || 0), 0);
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {metrics.map((m, i) => {
        const pct = Math.round(((m.value || 0) / max) * 100);
        return (
          <div key={i}>
            <div className="flex items-center justify-between text-[10px] text-white/90">
              <span>{toText(m.label)}</span>
              <span className="font-mono font-medium">
                {m.value ?? 0} {toTextInline(m.unit)}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-black/20">
              <div
                className="h-full rounded-full bg-white/80 transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      <div className="mt-1 flex items-center justify-between border-t border-white/20 pt-1 text-[10px]">
        <span className="text-white/70">合计</span>
        <span className="font-mono font-bold text-white">{total} 元</span>
      </div>
    </div>
  );
}

/** 时间轴（行程/交通） */
function Timeline({ nodes }: { nodes: CardTimelineNode[] }) {
  return (
    <div className="mt-2 flex flex-col">
      {nodes.map((n, i) => (
        <div key={i} className="flex gap-2">
          {/* 轴线 + 圆点 */}
          <div className="flex flex-col items-center">
            <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-white shadow" />
            {i < nodes.length - 1 && <div className="w-px flex-1 bg-white/30" />}
          </div>
          {/* 内容 */}
          <div className={`pb-2 ${i < nodes.length - 1 ? "" : ""}`}>
            <span className="rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {toText(n.time)}
            </span>
            <p className="mt-0.5 text-[11px] leading-snug text-white/95">{toText(n.event)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 根据 tag 判断卡片该渲染哪种图形化组件 */
function CardVisual({ card }: { card: InferPlanCard }) {
  const items = Array.isArray(card.items) ? (card.items as unknown[]).map((v) => toText(v)) : [];
  const metrics = Array.isArray(card.metrics) ? (card.metrics as CardMetric[]) : [];
  const timeline = Array.isArray(card.timeline) ? (card.timeline as CardTimelineNode[]) : [];

  // 优先用模型显式给出的结构化字段
  if (metrics.length > 0) return <MetricBars metrics={metrics} />;
  if (timeline.length > 0) return <Timeline nodes={timeline} />;
  if (items.length > 0) return <CheckList items={items} />;

  // 兜底：无结构化字段时显示 body
  return (
    <p className={`mt-2 whitespace-pre-wrap text-xs leading-relaxed ${"text-white/90"}`}>
      {toText(card.body)}
    </p>
  );
}

/* ----------------------- 单张卡片 ----------------------- */

function Card({
  card,
  index,
  total,
  theme,
  isTop,
  isFlipped,
  onBringToFront,
  onFlip,
}: {
  card: InferPlanCard;
  index: number;
  total: number;
  theme: Theme;
  isTop: boolean;
  isFlipped: boolean;
  onBringToFront: () => void;
  onFlip: () => void;
}) {
  const gradient = theme.gradients[index % theme.gradients.length];
  const stackOffset = (total - 1 - index) * 6;

  return (
    <div
      className="absolute inset-0 transition-all duration-500 ease-out"
      style={{
        transform: isTop
          ? "translateY(0) scale(1)"
          : `translate(${stackOffset}px, -${stackOffset}px) scale(0.96)`,
        zIndex: isTop ? 50 : total - index,
        opacity: isTop ? 1 : 0.85,
        filter: isTop ? "none" : "saturate(0.85)",
        pointerEvents: isTop ? "auto" : "none",
      }}
    >
      <div
        className="relative h-full w-full transition-transform duration-700 [transform-style:preserve-3d]"
        style={{ transform: isFlipped ? "rotateY(180deg)" : "none" }}
      >
        {/* 正面 */}
        <button
          onClick={onBringToFront}
          onDoubleClick={onFlip}
          className={`absolute inset-0 flex h-full w-full flex-col overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-5 text-left shadow-xl ${theme.glow} [backface-visibility:hidden]`}
        >
          {/* 装饰光斑 */}
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-black/10 blur-2xl" />

          {/* 顶部：icon + tag */}
          <div className="relative flex items-start justify-between">
            <span className="text-4xl drop-shadow-md">{toText(card.icon) || theme.emoji}</span>
            <span className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              {toText(card.tag) || "卡片"}
            </span>
          </div>

          {/* 标题 */}
          <h3 className="relative mt-2 text-lg font-bold leading-tight text-white drop-shadow-sm">
            {toText(card.title)}
          </h3>

          {/* 亮点（若有）*/}
          {toText(card.highlight) && (
            <p className="relative mt-1 rounded-lg bg-white/15 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              ✦ {toText(card.highlight)}
            </p>
          )}

          {/* 图形化内容区（可滚动）*/}
          <div className="relative mt-1 flex-1 overflow-y-auto pr-1">
            <CardVisual card={card} />
          </div>

          {/* 底部 */}
          <div className="relative flex items-center justify-between pt-1 text-[10px] text-white/70">
            <span>
              {index + 1} / {total}
            </span>
            <span className="hidden sm:inline">双击翻转</span>
          </div>
        </button>

        {/* 背面 */}
        <div className="absolute inset-0 flex h-full w-full flex-col gap-2 overflow-y-auto rounded-2xl bg-zinc-900 p-5 text-left shadow-xl [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div className="text-3xl">{toText(card.icon) || theme.emoji}</div>
          <h3 className="text-base font-bold text-white">{toText(card.title)}</h3>
          <div className="rounded-lg bg-white/5 p-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              分类 · {toText(card.tag)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
              {toText(card.body)}
            </p>
          </div>
          {toText(card.highlight) && (
            <div className="rounded-lg border border-zinc-700 p-2 text-[11px] text-zinc-300">
              <span className="text-zinc-500">亮点：</span>
              {toText(card.highlight)}
            </div>
          )}
          <button
            onClick={onFlip}
            className="mt-auto self-start rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-zinc-300 hover:bg-white/20"
          >
            ↺ 翻回正面
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- 主组件 ----------------------- */

export function StackedCards() {
  const { result, steps } = useInferStore();
  const [topIdx, setTopIdx] = useState(0);
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});

  const taskType = steps.slot_definition.outputs.task_type;
  const theme = useMemo(() => pickTheme(taskType), [taskType]);

  if (!result || !result.cards || result.cards.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-center text-xs text-zinc-400">
          执行「⑦ 生成」后，
          <br />
          方案卡片会以堆叠动效呈现
        </p>
      </div>
    );
  }

  const cards = result.cards;
  const total = cards.length;
  const safeTop = Math.min(topIdx, total - 1);

  return (
    <div className="flex h-full flex-col">
      {/* 顶部 */}
      <div className="shrink-0 px-4 pt-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{theme.emoji}</span>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {theme.name}方案 · {total} 张卡片
          </h2>
        </div>
        {result.summary && (
          <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            {toText(result.summary)}
          </p>
        )}
      </div>

      {/* 卡片堆叠区 */}
      <div className="relative mx-4 my-3 h-[300px] shrink-0">
        {cards.map((card, idx) => (
          <Card
            key={idx}
            card={card}
            index={idx}
            total={total}
            theme={theme}
            isTop={idx === safeTop}
            isFlipped={!!flipped[idx]}
            onBringToFront={() => {
              setTopIdx(idx);
              if (flipped[idx]) setFlipped((f) => ({ ...f, [idx]: false }));
            }}
            onFlip={() => setFlipped((f) => ({ ...f, [idx]: !f[idx] }))}
          />
        ))}
      </div>

      {/* 导航点 */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 px-4 pb-2">
        {cards.map((card, idx) => (
          <button
            key={idx}
            onClick={() => {
              setTopIdx(idx);
              if (flipped[idx]) setFlipped((f) => ({ ...f, [idx]: false }));
            }}
            title={toText(card.title)}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] transition-all ${
              idx === safeTop
                ? `scale-110 bg-gradient-to-br ${theme.gradients[idx % theme.gradients.length]} text-white shadow-md`
                : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {toText(card.icon).slice(0, 2) || idx + 1}
          </button>
        ))}
      </div>

      {/* 假设清单 */}
      {result.assumptions && result.assumptions.length > 0 && (
        <div className="mx-4 mb-3 mt-1 shrink-0 overflow-y-auto">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            基于的假设（可纠正）
          </h3>
          <div className="flex flex-col gap-1">
            {result.assumptions.map((a, i) => (
              <div
                key={i}
                className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
              >
                {toText(a)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto shrink-0 border-t border-zinc-100 px-4 py-2 dark:border-zinc-900">
        <p className="text-[10px] text-zinc-400">
          点击卡片/圆点切换 · 双击翻转 · 清单项可勾选
        </p>
      </div>
    </div>
  );
}
