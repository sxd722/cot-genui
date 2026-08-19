"use client";

import { useMemo, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  A2UI 类型（精简版，仅渲染所需）                                      */
/* ------------------------------------------------------------------ */

interface A2UIComponent {
  id: string;
  component: string;
  child?: string;
  children?: string[] | { componentId: string; path: string };
  text?: string;
  variant?: string;
  action?: { event?: { name: string; context?: Record<string, unknown> }; functionCall?: { call: string; args?: Record<string, unknown> } };
  justify?: string;
  align?: string;
  axis?: string;
  url?: string;
  fit?: string;
  label?: string;
  value?: unknown;
  min?: number;
  max?: number;
  options?: unknown[];
  tabs?: { title: string; child: string }[];
  weight?: number;
  title?: string;
  subtitle?: string;
  detail?: string;
  unit?: string;
  tone?: string;
  icon?: string;
  items?: unknown[];
  [key: string]: unknown;
}

interface A2UIMessage {
  version?: string;
  createSurface?: { surfaceId: string; catalogId?: string };
  updateComponents?: { surfaceId: string; components: A2UIComponent[] };
  updateDataModel?: { surfaceId: string; path?: string; value?: unknown };
}

/* ------------------------------------------------------------------ */
/*  A2UI 渲染器                                                         */
/* ------------------------------------------------------------------ */

/**
 * 解析 A2UI JSONL 消息数组，构建组件树并渲染为 React。
 * 支持 18 个标准组件的基本渲染 + 交互反馈。
 */
export function A2UIRenderer({ messages }: { messages: unknown[] }) {
  const { components, dataModel } = useMemo(() => parseMessages(messages), [messages]);
  const [actionLog, setActionLog] = useState<string | null>(null);

  if (components.length === 0) {
    return <div className="p-4 text-center text-[10px] text-zinc-500">无 A2UI 组件</div>;
  }

  // 找根组件（被其他组件引用最少的，通常是 Card）
  const referencedIds = new Set<string>();
  for (const c of components) {
    if (c.child) referencedIds.add(c.child);
    if (Array.isArray(c.children)) c.children.forEach((id) => referencedIds.add(id));
  }
  const roots = components.filter((c) => !referencedIds.has(c.id));
  const root = roots[0] ?? components[0];

  const handleAction = (action: A2UIComponent["action"]) => {
    if (!action) return;
    if (action.event) {
      setActionLog(`📡 event: ${action.event.name}${action.event.context ? ` ${JSON.stringify(action.event.context)}` : ""}`);
    } else if (action.functionCall) {
      const fc = action.functionCall;
      if (fc.call === "openUrl" && fc.args?.url) {
        setActionLog(`🔗 openUrl: ${fc.args.url}`);
        window.open(String(fc.args.url), "_blank", "noopener,noreferrer");
      } else {
        setActionLog(`⚙️ ${fc.call}(${fc.args ? JSON.stringify(fc.args) : ""})`);
      }
    }
    setTimeout(() => setActionLog(null), 3000);
  };

  return (
    <div className="relative h-full w-full" style={{ background: "var(--a2ui-bg, #0B0D10)" }}>
      {/* 2x4 手机桌面卡片容器 */}
      <div
        className="mx-auto flex h-full flex-col overflow-hidden p-2"
        style={{ maxWidth: "320px" }}
      >
        <div className="flex-1 overflow-y-auto">
          {renderComponent(root, components, dataModel, handleAction)}
        </div>
      </div>
      {/* action 反馈 toast */}
      {actionLog && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1.5 text-[10px] text-emerald-400 backdrop-blur">
          {actionLog}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  解析消息                                                            */
/* ------------------------------------------------------------------ */

function parseMessages(messages: unknown[]): {
  components: A2UIComponent[];
  dataModel: Record<string, unknown>;
} {
  let components: A2UIComponent[] = [];
  let dataModel: Record<string, unknown> = {};

  for (const msg of messages) {
    const m = msg as A2UIMessage;
    if (m.updateComponents?.components) {
      // 合并组件（后者覆盖前者，按 id）
      const map = new Map(components.map((c) => [c.id, c]));
      for (const c of m.updateComponents.components) map.set(c.id, c);
      components = [...map.values()];
    }
    if (m.updateDataModel) {
      const path = m.updateDataModel.path ?? "/";
      if (path === "/" && m.updateDataModel.value && typeof m.updateDataModel.value === "object") {
        dataModel = { ...dataModel, ...(m.updateDataModel.value as Record<string, unknown>) };
      }
    }
  }
  return { components, dataModel };
}

/* ------------------------------------------------------------------ */
/*  组件渲染                                                            */
/* ------------------------------------------------------------------ */

function resolveDynamic(val: unknown, dataModel: Record<string, unknown>): unknown {
  if (val && typeof val === "object" && "path" in val) {
    const path = (val as { path: string }).path;
    // 简化 JSON Pointer 解析
    const parts = path.split("/").filter(Boolean);
    let cur: unknown = dataModel;
    for (const p of parts) {
      if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
      else return undefined;
    }
    return cur;
  }
  return val;
}

function renderComponent(
  comp: A2UIComponent,
  all: A2UIComponent[],
  dataModel: Record<string, unknown>,
  onAction: (a: A2UIComponent["action"]) => void,
): ReactNode {
  const childBy = (id?: string) => (id ? all.find((c) => c.id === id) : undefined);
  const renderChild = (id?: string) => {
    const c = childBy(id);
    return c ? renderComponent(c, all, dataModel, onAction) : null;
  };
  const renderChildren = (children?: string[]) =>
    (children ?? []).map((id) => renderChild(id));

  switch (comp.component) {
    case "Card":
      return (
        <div key={comp.id} className="rounded-xl bg-white/[0.06] p-3 shadow-lg backdrop-blur">
          {renderChild(comp.child)}
        </div>
      );

    case "Column": {
      const justify = flexJustify(comp.justify);
      const align = flexAlign(comp.align);
      return (
        <div key={comp.id} className={`flex flex-col ${justify} ${align} gap-1.5`}>
          {Array.isArray(comp.children) ? renderChildren(comp.children) : null}
        </div>
      );
    }

    case "Row": {
      const justify = flexJustify(comp.justify);
      const align = flexAlign(comp.align);
      return (
        <div key={comp.id} className={`flex flex-row ${justify} ${align} gap-2`}>
          {Array.isArray(comp.children) ? renderChildren(comp.children) : null}
        </div>
      );
    }

    case "List":
      return (
        <div key={comp.id} className="flex flex-col gap-1.5">
          {Array.isArray(comp.children) ? renderChildren(comp.children) : null}
        </div>
      );

    case "Text": {
      const val = resolveDynamic(comp.text, dataModel);
      const variantCls = textVariant(comp.variant);
      return (
        <span key={comp.id} className={variantCls}>
          {String(val ?? "")}
        </span>
      );
    }

    case "Hero":
      return (
        <div key={comp.id} className="rounded-xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/15 via-indigo-400/10 to-transparent p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              {comp.label && <span className="text-[9px] uppercase tracking-[0.16em] text-cyan-300/70">{String(comp.label)}</span>}
              <div className="mt-0.5 text-lg font-semibold leading-tight text-white">{String(comp.title ?? comp.text ?? "")}</div>
              {comp.subtitle && <div className="mt-1 text-[11px] leading-relaxed text-white/60">{String(comp.subtitle)}</div>}
            </div>
            {comp.icon && <span className="text-2xl">{String(comp.icon)}</span>}
          </div>
        </div>
      );

    case "Metric":
      return (
        <div key={comp.id} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.06] p-2.5">
          <div className="text-[9px] uppercase tracking-wide text-white/40">{String(comp.label ?? comp.title ?? "指标")}</div>
          <div className="mt-0.5 text-xl font-semibold text-white">
            {String(resolveDynamic(comp.value, dataModel) ?? "—")}
            {comp.unit && <span className="ml-1 text-[10px] font-normal text-white/45">{String(comp.unit)}</span>}
          </div>
          {comp.detail && <div className="mt-0.5 text-[9px] text-white/45">{String(comp.detail)}</div>}
        </div>
      );

    case "Progress": {
      const value = Number(resolveDynamic(comp.value, dataModel) ?? 0);
      const max = Number(comp.max ?? 100) || 100;
      const percent = Math.max(0, Math.min(100, (value / max) * 100));
      return (
        <div key={comp.id} className="rounded-lg bg-white/[0.04] p-2.5">
          <div className="mb-1.5 flex justify-between text-[10px] text-white/65">
            <span>{String(comp.label ?? comp.title ?? "进度")}</span><span>{Math.round(percent)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-indigo-400" style={{ width: `${percent}%` }} /></div>
          {comp.detail && <div className="mt-1 text-[9px] text-white/40">{String(comp.detail)}</div>}
        </div>
      );
    }

    case "Badge":
      return <span key={comp.id} className="inline-flex w-fit rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[9px] font-medium text-cyan-200">{String(comp.text ?? comp.label ?? comp.value ?? "")}</span>;

    case "Timeline": {
      const items = Array.isArray(comp.items) ? comp.items : [];
      return (
        <div key={comp.id} className="space-y-2">
          {items.map((item, index) => {
            const row = item && typeof item === "object" ? item as Record<string, unknown> : { title: item };
            return <div key={index} className="relative border-l border-cyan-300/25 pl-3"><span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-cyan-300"/><div className="text-[9px] text-cyan-300/70">{String(row.time ?? "")}</div><div className="text-[11px] font-medium text-white/85">{String(row.title ?? row.label ?? "")}</div>{row.detail != null && <div className="text-[9px] text-white/45">{String(row.detail)}</div>}</div>;
          })}
        </div>
      );
    }

    case "Button": {
      const variantCls = buttonVariant(comp.variant);
      return (
        <button
          key={comp.id}
          onClick={() => onAction(comp.action)}
          className={`rounded-lg px-3 py-1.5 text-[11px] transition-all active:scale-95 ${variantCls}`}
        >
          {renderChild(comp.child)}
        </button>
      );
    }

    case "Image": {
      const url = resolveDynamic(comp.url, dataModel);
      return (
        // A2UI image URLs are dynamic provider data, so Next/Image cannot predeclare their hosts.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={comp.id}
          src={String(url ?? "")}
          className="max-w-full rounded-lg"
          style={{ objectFit: (comp.fit as React.CSSProperties["objectFit"]) ?? "contain" }}
          alt=""
        />
      );
    }

    case "Divider":
      return <hr key={comp.id} className={comp.axis === "vertical" ? "h-full w-px border-white/10" : "border-white/10"} />;

    case "Icon":
      return <span key={comp.id} className="text-base">{String(comp.name ?? "◆")}</span>;

    case "CheckBox": {
      return (
        <label key={comp.id} className="flex items-center gap-1.5 text-[11px] text-white/80">
          <input type="checkbox" className="accent-[#D7AE59]" />
          {String(resolveDynamic(comp.label, dataModel) ?? "")}
        </label>
      );
    }

    case "Slider": {
      return (
        <input
          key={comp.id}
          type="range"
          min={comp.min ?? 0}
          max={comp.max ?? 100}
          defaultValue={Number(resolveDynamic(comp.value, dataModel) ?? 50)}
          className="w-full accent-[#D7AE59]"
        />
      );
    }

    case "ChoicePicker": {
      const opts = Array.isArray(comp.options) ? comp.options : [];
      return (
        <div key={comp.id} className="flex flex-wrap gap-1">
          {opts.map((o, i) => (
            <button key={i} className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-white/70 hover:border-[#D7AE59]">
              {typeof o === "string" ? o : String((o as Record<string, unknown>)?.label ?? o)}
            </button>
          ))}
        </div>
      );
    }

    case "Tabs": {
      return <A2UITabs key={comp.id} comp={comp} all={all} dataModel={dataModel} onAction={onAction} />;
    }

    default:
      return <div key={comp.id} className="text-[9px] text-zinc-500">[{comp.component}]</div>;
  }
}

function A2UITabs({
  comp,
  all,
  dataModel,
  onAction,
}: {
  comp: A2UIComponent;
  all: A2UIComponent[];
  dataModel: Record<string, unknown>;
  onAction: (action: A2UIComponent["action"]) => void;
}) {
  const tabs = comp.tabs ?? [];
  const [active, setActive] = useState(0);
  const selected = tabs[active];
  const child = selected ? all.find((candidate) => candidate.id === selected.child) : undefined;
  return (
    <div>
      <div className="flex gap-1 border-b border-white/10">
        {tabs.map((tab, index) => (
          <button
            key={index}
            onClick={() => setActive(index)}
            className={`px-2 py-1 text-[10px] ${index === active ? "border-b-2 border-[#D7AE59] text-[#D7AE59]" : "text-white/50"}`}
          >
            {tab.title}
          </button>
        ))}
      </div>
      <div className="pt-1.5">{child ? renderComponent(child, all, dataModel, onAction) : null}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  样式辅助                                                            */
/* ------------------------------------------------------------------ */

function flexJustify(j?: string): string {
  switch (j) {
    case "center": return "justify-center";
    case "end": return "justify-end";
    case "spaceBetween": return "justify-between";
    case "spaceAround": return "justify-around";
    case "spaceEvenly": return "justify-evenly";
    default: return "justify-start";
  }
}

function flexAlign(a?: string): string {
  switch (a) {
    case "center": return "items-center";
    case "end": return "items-end";
    default: return "items-start";
  }
}

function textVariant(v?: string): string {
  switch (v) {
    case "h1": return "text-[28px] font-bold text-white leading-tight";
    case "h2": return "text-[24px] font-bold text-white leading-tight";
    case "h3": return "text-[20px] font-bold text-white leading-tight";
    case "h4": return "text-[18px] font-semibold text-white";
    case "h5": return "text-[14px] font-semibold text-white";
    case "caption": return "text-[10px] text-white/50";
    default: return "text-[12px] text-white/80";
  }
}

function buttonVariant(v?: string): string {
  switch (v) {
    case "primary": return "bg-[#D7AE59] text-black font-semibold hover:brightness-110";
    case "borderless": return "text-white/60 hover:text-white/90";
    default: return "border border-white/25 text-white/80 hover:border-white/50";
  }
}

/* ------------------------------------------------------------------ */
/*  iframe 渲染（独立沙箱环境）                                          */
/* ------------------------------------------------------------------ */

/**
 * 生成一个完整的 HTML 文档字符串，在 iframe 内渲染 A2UI 组件。
 * 使用纯 JS 解析扁平邻接表，生成 DOM，支持基本交互。
 */
export function renderA2UIIframe(messages: unknown[]): string {
  const json = JSON.stringify(messages);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* === Liquid Glass Design System === */
  :root {
    --glass-bg: rgba(255,255,255,0.07);
    --glass-bg-hover: rgba(255,255,255,0.12);
    --glass-border: rgba(255,255,255,0.15);
    --glass-border-bright: rgba(255,255,255,0.25);
    --glass-blur: blur(20px);
    --glass-blur-heavy: blur(30px);
    --on-glass: rgba(255,255,255,0.92);
    --on-glass-dim: rgba(255,255,255,0.55);
    --on-glass-muted: rgba(255,255,255,0.35);
    --accent: #6ee7ff;
    --accent-glow: rgba(110,231,255,0.3);
    --accent-warm: #c4b5fd;
    --accent-warm-glow: rgba(196,181,253,0.25);
    --radius-card: 28px;
    --radius-md: 16px;
    --radius-full: 9999px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background:
      radial-gradient(ellipse at 20% 0%, #1a1f3a 0%, transparent 50%),
      radial-gradient(ellipse at 80% 100%, #2a1a3a 0%, transparent 50%),
      radial-gradient(ellipse at 50% 50%, #141828 0%, #0a0c16 100%);
    color: var(--on-glass);
    font-family: -apple-system, 'SF Pro Display', 'Noto Sans', system-ui, sans-serif;
    padding: 0;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }
  /* Ambient floating orbs */
  body::before, body::after {
    content: '';
    position: fixed;
    border-radius: 50%;
    filter: blur(80px);
    z-index: 0;
    pointer-events: none;
  }
  body::before {
    width: 200px; height: 200px;
    background: rgba(99,102,241,0.12);
    top: 10%; left: -30px;
    animation: floatOrb1 8s ease-in-out infinite;
  }
  body::after {
    width: 250px; height: 250px;
    background: rgba(110,231,255,0.08);
    bottom: 5%; right: -40px;
    animation: floatOrb2 10s ease-in-out infinite;
  }
  @keyframes floatOrb1 { 0%,100% { transform: translateY(0) } 50% { transform: translateY(20px) } }
  @keyframes floatOrb2 { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-15px) } }

  /* Navigation bar — glass */
  #a2ui-nav {
    display: none;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(255,255,255,0.04);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border-bottom: 1px solid var(--glass-border);
    overflow-x: auto;
    flex-wrap: nowrap;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  #a2ui-nav button {
    white-space: nowrap;
    border-radius: var(--radius-full);
    padding: 5px 14px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg);
    backdrop-filter: blur(8px);
    color: var(--on-glass-dim);
    cursor: pointer;
    transition: all 0.2s;
  }
  #a2ui-nav button:hover { background: var(--glass-bg-hover); color: var(--on-glass); }
  #a2ui-nav button.active {
    background: linear-gradient(135deg, var(--accent) 0%, #818cf8 100%);
    color: #0a0c16; border-color: transparent;
    box-shadow: 0 0 16px var(--accent-glow);
  }

  /* Content area */
  #a2ui-content { padding: 12px; min-height: 400px; position: relative; z-index: 1; }

  /* === LIQUID GLASS CARD === */
  .a2ui-card {
    position: relative;
    border-radius: var(--radius-card);
    /* Liquid glass: layered transparency + blur */
    background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%);
    backdrop-filter: var(--glass-blur-heavy);
    -webkit-backdrop-filter: var(--glass-blur-heavy);
    padding: 20px;
    border: 1px solid var(--glass-border);
    /* Edge glow — the signature liquid glass effect */
    box-shadow:
      inset 0 1px 1px rgba(255,255,255,0.15),
      inset 0 -1px 1px rgba(0,0,0,0.1),
      0 8px 32px rgba(0,0,0,0.4),
      0 0 60px rgba(99,102,241,0.05);
    overflow: hidden;
  }
  /* Top edge light refraction */
  .a2ui-card::before {
    content: '';
    position: absolute;
    top: 0; left: 15%; right: 15%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  }
  /* Inner ambient glow */
  .a2ui-card::after {
    content: '';
    position: absolute;
    top: -50%; right: -30%;
    width: 200px; height: 200px;
    background: radial-gradient(circle, rgba(110,231,255,0.06) 0%, transparent 70%);
    pointer-events: none;
  }

  /* Layout */
  .a2ui-col { display: flex; flex-direction: column; gap: 8px; }
  .a2ui-row { display: flex; flex-direction: row; gap: 10px; }
  .a2ui-list { display: flex; flex-direction: column; gap: 8px; }

  /* Text — frosted white with depth */
  .a2ui-text { font-size: 14px; color: var(--on-glass-dim); line-height: 1.5; }
  .a2ui-text-h1 { font-size: 28px; font-weight: 700; color: #fff; line-height: 1.25; letter-spacing: -0.02em; text-shadow: 0 2px 8px rgba(0,0,0,0.3); }
  .a2ui-text-h2 { font-size: 24px; font-weight: 600; color: #fff; line-height: 1.3; text-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  .a2ui-text-h3 { font-size: 20px; font-weight: 600; color: #fff; line-height: 1.35; }
  .a2ui-text-h4 { font-size: 18px; font-weight: 600; color: var(--on-glass); }
  .a2ui-text-h5 { font-size: 14px; font-weight: 600; color: var(--accent); }
  .a2ui-text-caption { font-size: 11px; color: var(--on-glass-muted); letter-spacing: 0.05em; }

  /* === LIQUID GLASS BUTTON === */
  .a2ui-btn {
    border-radius: var(--radius-full);
    padding: 9px 22px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    border: 1px solid var(--glass-border);
    background: var(--glass-bg);
    backdrop-filter: blur(8px);
    color: var(--on-glass);
    position: relative;
    overflow: hidden;
  }
  .a2ui-btn:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-bright);
    box-shadow: 0 0 20px rgba(255,255,255,0.08);
    transform: translateY(-1px);
  }
  .a2ui-btn:active { transform: scale(0.96); }
  .a2ui-btn-primary {
    background: linear-gradient(135deg, var(--accent) 0%, #818cf8 100%);
    color: #0a0c16; border: none;
    box-shadow: 0 0 20px var(--accent-glow), 0 4px 16px rgba(99,102,241,0.3);
  }
  .a2ui-btn-primary:hover {
    box-shadow: 0 0 30px var(--accent-glow), 0 6px 24px rgba(99,102,241,0.4);
    filter: brightness(1.08);
  }
  .a2ui-btn-borderless { border: none; background: transparent; color: var(--accent); }
  .a2ui-btn-borderless:hover { background: rgba(110,231,255,0.08); }

  /* Divider — subtle light line */
  .a2ui-divider { border: none; border-top: 1px solid rgba(255,255,255,0.08); }
  .a2ui-divider-v { width: 1px; height: 100%; background: rgba(255,255,255,0.08); border: none; }

  /* Image */
  .a2ui-img { max-width: 100%; border-radius: var(--radius-md); border: 1px solid var(--glass-border); }

  /* Checkbox */
  .a2ui-checkbox { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--on-glass-dim); }
  .a2ui-checkbox input { accent-color: var(--accent); width: 16px; height: 16px; }

  /* Slider */
  .a2ui-slider { width: 100%; accent-color: var(--accent); height: 4px; }

  /* Choice picker — liquid pills */
  .a2ui-choice { display: flex; flex-wrap: wrap; gap: 6px; }
  .a2ui-choice button {
    border-radius: var(--radius-full);
    border: 1px solid var(--glass-border);
    padding: 5px 14px;
    font-size: 11px;
    font-weight: 500;
    color: var(--on-glass-dim);
    background: var(--glass-bg);
    backdrop-filter: blur(6px);
    cursor: pointer;
    transition: all 0.2s;
  }
  .a2ui-choice button:hover { border-color: var(--accent); color: var(--accent); }
  .a2ui-choice button.selected {
    background: linear-gradient(135deg, var(--accent) 0%, #818cf8 100%);
    color: #0a0c16; border-color: transparent;
    box-shadow: 0 0 12px var(--accent-glow);
  }

  /* Rich semantic components compiled from CardPlan */
  .a2ui-hero {
    padding: 14px; border-radius: 18px;
    border: 1px solid rgba(110,231,255,0.16);
    background: linear-gradient(135deg, rgba(110,231,255,0.14), rgba(129,140,248,0.10) 55%, rgba(255,255,255,0.02));
    box-shadow: inset 0 1px rgba(255,255,255,0.10);
  }
  .a2ui-hero-top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .a2ui-hero-label { font-size: 9px; color: rgba(110,231,255,0.72); text-transform: uppercase; letter-spacing: .15em; }
  .a2ui-hero-title { margin-top: 3px; font-size: 20px; line-height: 1.2; font-weight: 700; color: #fff; }
  .a2ui-hero-subtitle { margin-top: 6px; font-size: 11px; line-height: 1.5; color: var(--on-glass-dim); }
  .a2ui-hero-icon { font-size: 26px; }
  .a2ui-metric { min-width: 0; flex: 1; padding: 10px; border-radius: 14px; background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.09); }
  .a2ui-metric-label { font-size: 9px; color: var(--on-glass-muted); text-transform: uppercase; letter-spacing: .06em; }
  .a2ui-metric-value { margin-top: 2px; font-size: 22px; font-weight: 700; color: #fff; }
  .a2ui-metric-unit { margin-left: 4px; font-size: 10px; font-weight: 400; color: var(--on-glass-dim); }
  .a2ui-metric-detail { margin-top: 2px; font-size: 9px; color: var(--on-glass-muted); }
  .a2ui-progress { padding: 10px; border-radius: 14px; background: rgba(255,255,255,.04); }
  .a2ui-progress-head { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 10px; color: var(--on-glass-dim); }
  .a2ui-progress-track { height: 6px; overflow: hidden; border-radius: 99px; background: rgba(255,255,255,.09); }
  .a2ui-progress-fill { height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--accent), #818cf8); box-shadow: 0 0 10px var(--accent-glow); }
  .a2ui-progress-detail { margin-top: 5px; font-size: 9px; color: var(--on-glass-muted); }
  .a2ui-badge { display: inline-flex; width: fit-content; padding: 3px 9px; border-radius: 99px; border: 1px solid rgba(110,231,255,.20); background: rgba(110,231,255,.10); color: #bff6ff; font-size: 9px; font-weight: 600; }
  .a2ui-timeline { display: flex; flex-direction: column; gap: 9px; }
  .a2ui-timeline-item { position: relative; margin-left: 4px; padding-left: 13px; border-left: 1px solid rgba(110,231,255,.24); }
  .a2ui-timeline-item::before { content: ''; position: absolute; left: -4px; top: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent-glow); }
  .a2ui-timeline-time { font-size: 9px; color: rgba(110,231,255,.68); }
  .a2ui-timeline-title { font-size: 11px; font-weight: 600; color: var(--on-glass); }
  .a2ui-timeline-detail { margin-top: 1px; font-size: 9px; color: var(--on-glass-muted); }

  /* Toast — floating glass pill */
  #a2ui-toast {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255,255,255,0.1);
    backdrop-filter: var(--glass-blur);
    color: var(--on-glass);
    padding: 8px 20px;
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 500;
    display: none;
    border: 1px solid var(--glass-border);
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    z-index: 999;
    transition: opacity 0.3s, transform 0.3s;
  }

  /* Flex helpers */
  .jc { justify-content: center; } .je { justify-content: flex-end; }
  .jsb { justify-content: space-between; } .jsa { justify-content: space-around; }
  .jse { justify-content: space-evenly; }
  .ic { align-items: center; } .ie { align-items: flex-end; }

  /* Page transition — smooth glass morph */
  .a2ui-page-enter { animation: glassIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
  @keyframes glassIn {
    from { opacity: 0; transform: translateY(12px) scale(0.98); filter: blur(4px); }
    to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
  }
</style>
</head>
<body>
<div id="a2ui-nav"></div>
<div id="a2ui-content"></div>
<div id="a2ui-toast"></div>
<script>
(function() {
  var messages = ${json};

  // —— Runtime State ——
  var surfaces = {};           // surfaceId → { components: {}, dataModel: {}, label: string }
  var surfaceOrder = [];       // 有序的 surfaceId 列表
  var currentSurface = null;   // 当前显示的 surfaceId
  var selectedValues = {};     // 用户选择的值（key → value）
  var navEl = document.getElementById('a2ui-nav');
  var contentEl = document.getElementById('a2ui-content');
  var toastEl = document.getElementById('a2ui-toast');
  var toastTimer;

  // —— 解析消息 ——
  messages.forEach(function(msg) {
    if (msg.createSurface) {
      var sid = msg.createSurface.surfaceId;
      if (!surfaces[sid]) {
        surfaces[sid] = { components: {}, dataModel: {}, label: sid };
        surfaceOrder.push(sid);
      }
      if (!currentSurface) currentSurface = sid;
    }
    if (msg.updateComponents) {
      var sid2 = msg.updateComponents.surfaceId;
      if (!surfaces[sid2]) {
        surfaces[sid2] = { components: {}, dataModel: {}, label: sid2 };
        surfaceOrder.push(sid2);
      }
      msg.updateComponents.components.forEach(function(c) {
        surfaces[sid2].components[c.id] = c;
        // 尝试从组件提取 surface label（找第一个 Text h3/h2 作为标题）
        if (!surfaces[sid2]._labeled && c.component === 'Text' && (c.variant === 'h2' || c.variant === 'h3')) {
          surfaces[sid2].label = String(c.text || sid2).slice(0, 12);
          surfaces[sid2]._labeled = true;
        }
      });
    }
    if (msg.updateDataModel) {
      var sid3 = msg.updateDataModel.surfaceId;
      if (!surfaces[sid3]) {
        surfaces[sid3] = { components: {}, dataModel: {}, label: sid3 };
        surfaceOrder.push(sid3);
      }
      if (msg.updateDataModel.path === '/' && msg.updateDataModel.value) {
        Object.assign(surfaces[sid3].dataModel, msg.updateDataModel.value);
      }
    }
  });

  // 如果没有 surface，把所有组件放进一个默认 surface
  if (surfaceOrder.length === 0) {
    var allComponents = {};
    messages.forEach(function(msg) {
      if (msg.updateComponents) {
        msg.updateComponents.components.forEach(function(c) { allComponents[c.id] = c; });
      }
    });
    if (Object.keys(allComponents).length > 0) {
      surfaces['default'] = { components: allComponents, dataModel: {}, label: '卡片' };
      surfaceOrder = ['default'];
      currentSurface = 'default';
    }
  }

  // —— 数据绑定解析 ——
  function resolve(val, dataModel) {
    if (val && typeof val === 'object' && val.path) {
      var parts = val.path.split('/').filter(Boolean);
      var cur = dataModel;
      for (var i = 0; i < parts.length; i++) {
        if (cur && typeof cur === 'object') cur = cur[parts[i]];
        else return undefined;
      }
      return cur;
    }
    return val;
  }

  // —— Toast ——
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() {
      toastEl.style.opacity = '0';
      setTimeout(function() { toastEl.style.display = 'none'; }, 300);
    }, 2500);
  }

  // —— Action 处理（核心交互逻辑）——
  function handleAction(action) {
    if (!action) return;

    if (action.event) {
      var evt = action.event;
      var ctx = evt.context || {};
      var eventName = evt.name;

      // goto / navigate → 切换 surface
      if (eventName === 'goto' || eventName === 'navigate') {
        var target = ctx.card || ctx.target || ctx.surfaceId || ctx.surface;
        if (target && surfaces[target]) {
          switchSurface(target);
          showToast('📄 → ' + surfaces[target].label);
        } else if (target) {
          showToast('⚠️ 找不到卡片: ' + target);
        }
        return;
      }

      // select → 写入值 + 可能跳转
      if (eventName === 'select') {
        var key = ctx.key || ctx.slot || ctx.writeTo || 'selected';
        var val = ctx.value !== undefined ? ctx.value : (ctx.val !== undefined ? ctx.val : '');
        selectedValues[key] = val;
        // 写入当前 surface 的 dataModel
        if (currentSurface && surfaces[currentSurface]) {
          surfaces[currentSurface].dataModel[key] = val;
        }
        showToast('☑ ' + key + ' = ' + val);
        // 如果有跳转目标
        if (ctx.goto || ctx.card) {
          var t2 = ctx.goto || ctx.card;
          if (surfaces[t2]) {
            // 也写入目标 surface
            surfaces[t2].dataModel[key] = val;
            switchSurface(t2);
          }
        } else {
          // 没有跳转，重新渲染当前 surface（更新绑定显示）
          renderCurrent();
        }
        return;
      }

      // back → 返回上一个 surface
      if (eventName === 'back') {
        var idx = surfaceOrder.indexOf(currentSurface);
        if (idx > 0) {
          switchSurface(surfaceOrder[idx - 1]);
          showToast('← 返回');
        }
        return;
      }

      // copy → 模拟复制
      if (eventName === 'copy') {
        showToast('📋 已复制');
        return;
      }

      // save → 模拟保存
      if (eventName === 'save') {
        showToast('💾 已保存');
        return;
      }

      // llm / ai → 模拟 AI 调用
      if (eventName === 'llm' || eventName === 'ai') {
        showToast('🤖 AI 分析中…');
        return;
      }

      // 其他事件
      showToast('📡 ' + eventName + (Object.keys(ctx).length > 0 ? ' ' + JSON.stringify(ctx) : ''));
      return;
    }

    if (action.functionCall) {
      var fc = action.functionCall;
      if (fc.call === 'openUrl' && fc.args && fc.args.url) {
        showToast('🔗 ' + fc.args.url);
        try { window.open(fc.args.url, '_blank'); } catch(e) {}
      } else {
        showToast('⚙️ ' + fc.call);
      }
      return;
    }
  }

  // —— 切换 Surface ——
  function switchSurface(sid) {
    currentSurface = sid;
    renderCurrent();
    renderNav();
  }

  // —— 渲染导航条 ——
  function renderNav() {
    if (surfaceOrder.length <= 1) {
      navEl.style.display = 'none';
      return;
    }
    navEl.style.display = 'flex';
    navEl.innerHTML = '';
    surfaceOrder.forEach(function(sid) {
      var btn = document.createElement('button');
      btn.textContent = surfaces[sid].label || sid;
      if (sid === currentSurface) btn.classList.add('active');
      btn.onclick = function() { switchSurface(sid); };
      navEl.appendChild(btn);
    });
  }

  // —— 渲染当前 Surface ——
  function renderCurrent() {
    contentEl.innerHTML = '';
    if (!currentSurface || !surfaces[currentSurface]) return;
    var s = surfaces[currentSurface];
    var referenced = {};
    Object.values(s.components).forEach(function(c) {
      if (c.child) referenced[c.child] = true;
      if (Array.isArray(c.children)) c.children.forEach(function(id) { referenced[id] = true; });
    });
    var rootId = Object.keys(s.components).find(function(id) { return !referenced[id]; });
    if (rootId) {
      var page = document.createElement('div');
      page.className = 'a2ui-page-enter';
      page.appendChild(buildDOM(rootId, s));
      contentEl.appendChild(page);
    }
  }

  // —— 构建 DOM ——
  function buildDOM(id, surface) {
    var c = surface.components[id];
    if (!c) return document.createTextNode('');
    var dm = surface.dataModel;

    function resolveVal(val) { return resolve(val, dm); }
    function buildChild(cid) { return buildDOM(cid, surface); }
    function buildChildren(children) {
      return (children || []).map(function(cid) { return buildChild(cid); });
    }

    switch (c.component) {
      case 'Card': {
        var el = document.createElement('div');
        el.className = 'a2ui-card';
        if (c.child) el.appendChild(buildChild(c.child));
        return el;
      }
      case 'Column': {
        var el = document.createElement('div');
        el.className = 'a2ui-col';
        var j = c.justify || '';
        if (j === 'center') el.classList.add('jc');
        if (j === 'end') el.classList.add('je');
        if (j === 'spaceBetween' || j === 'space_between') el.classList.add('jsb');
        if (j === 'spaceAround' || j === 'space_around') el.classList.add('jsa');
        if (j === 'spaceEvenly' || j === 'space_evenly') el.classList.add('jse');
        if (c.align === 'center') el.classList.add('ic');
        if (c.align === 'end') el.classList.add('ie');
        if (Array.isArray(c.children)) buildChildren(c.children).forEach(function(d) { el.appendChild(d); });
        return el;
      }
      case 'Row': {
        var el = document.createElement('div');
        el.className = 'a2ui-row';
        var j2 = c.justify || '';
        if (j2 === 'center') el.classList.add('jc');
        if (j2 === 'end') el.classList.add('je');
        if (j2 === 'spaceBetween' || j2 === 'space_between') el.classList.add('jsb');
        if (j2 === 'spaceAround' || j2 === 'space_around') el.classList.add('jsa');
        if (j2 === 'spaceEvenly' || j2 === 'space_evenly') el.classList.add('jse');
        if (c.align === 'center') el.classList.add('ic');
        if (c.align === 'end') el.classList.add('ie');
        if (Array.isArray(c.children)) buildChildren(c.children).forEach(function(d) { el.appendChild(d); });
        return el;
      }
      case 'List': {
        var el = document.createElement('div');
        el.className = 'a2ui-list';
        if (Array.isArray(c.children)) buildChildren(c.children).forEach(function(d) { el.appendChild(d); });
        return el;
      }
      case 'Text': {
        var el = document.createElement('span');
        var v = c.variant || 'body';
        el.className = 'a2ui-text' + (v !== 'body' ? '-' + v : '');
        el.textContent = String(resolveVal(c.text) ?? '');
        return el;
      }
      case 'Hero': {
        var el = document.createElement('div');
        el.className = 'a2ui-hero';
        var top = document.createElement('div');
        top.className = 'a2ui-hero-top';
        var copy = document.createElement('div');
        if (c.label) { var label = document.createElement('div'); label.className = 'a2ui-hero-label'; label.textContent = String(c.label); copy.appendChild(label); }
        var title = document.createElement('div'); title.className = 'a2ui-hero-title'; title.textContent = String(c.title || c.text || ''); copy.appendChild(title);
        if (c.subtitle) { var subtitle = document.createElement('div'); subtitle.className = 'a2ui-hero-subtitle'; subtitle.textContent = String(c.subtitle); copy.appendChild(subtitle); }
        top.appendChild(copy);
        if (c.icon) { var icon = document.createElement('span'); icon.className = 'a2ui-hero-icon'; icon.textContent = String(c.icon); top.appendChild(icon); }
        el.appendChild(top);
        return el;
      }
      case 'Metric': {
        var el = document.createElement('div'); el.className = 'a2ui-metric';
        var label = document.createElement('div'); label.className = 'a2ui-metric-label'; label.textContent = String(c.label || c.title || '指标'); el.appendChild(label);
        var value = document.createElement('div'); value.className = 'a2ui-metric-value'; value.textContent = String(resolveVal(c.value) ?? '—');
        if (c.unit) { var unit = document.createElement('span'); unit.className = 'a2ui-metric-unit'; unit.textContent = String(c.unit); value.appendChild(unit); }
        el.appendChild(value);
        if (c.detail) { var detail = document.createElement('div'); detail.className = 'a2ui-metric-detail'; detail.textContent = String(c.detail); el.appendChild(detail); }
        return el;
      }
      case 'Progress': {
        var el = document.createElement('div'); el.className = 'a2ui-progress';
        var numeric = Number(resolveVal(c.value) || 0); var max = Number(c.max || 100) || 100; var percent = Math.max(0, Math.min(100, numeric / max * 100));
        var head = document.createElement('div'); head.className = 'a2ui-progress-head';
        var label = document.createElement('span'); label.textContent = String(c.label || c.title || '进度');
        var number = document.createElement('span'); number.textContent = Math.round(percent) + '%'; head.appendChild(label); head.appendChild(number); el.appendChild(head);
        var track = document.createElement('div'); track.className = 'a2ui-progress-track'; var fill = document.createElement('div'); fill.className = 'a2ui-progress-fill'; fill.style.width = percent + '%'; track.appendChild(fill); el.appendChild(track);
        if (c.detail) { var detail = document.createElement('div'); detail.className = 'a2ui-progress-detail'; detail.textContent = String(c.detail); el.appendChild(detail); }
        return el;
      }
      case 'Badge': {
        var el = document.createElement('span'); el.className = 'a2ui-badge'; el.textContent = String(c.text || c.label || resolveVal(c.value) || ''); return el;
      }
      case 'Timeline': {
        var el = document.createElement('div'); el.className = 'a2ui-timeline';
        (c.items || []).forEach(function(item) {
          var row = typeof item === 'object' && item ? item : { title: item };
          var node = document.createElement('div'); node.className = 'a2ui-timeline-item';
          if (row.time) { var time = document.createElement('div'); time.className = 'a2ui-timeline-time'; time.textContent = String(row.time); node.appendChild(time); }
          var title = document.createElement('div'); title.className = 'a2ui-timeline-title'; title.textContent = String(row.title || row.label || ''); node.appendChild(title);
          if (row.detail) { var detail = document.createElement('div'); detail.className = 'a2ui-timeline-detail'; detail.textContent = String(row.detail); node.appendChild(detail); }
          el.appendChild(node);
        });
        return el;
      }
      case 'Button': {
        var el = document.createElement('button');
        var cls = 'a2ui-btn';
        if (c.variant === 'primary') cls += ' a2ui-btn-primary';
        if (c.variant === 'borderless') cls += ' a2ui-btn-borderless';
        el.className = cls;
        if (c.child) el.appendChild(buildChild(c.child));
        else el.textContent = 'Button';
        if (c.action) el.onclick = function(e) { e.stopPropagation(); handleAction(c.action); };
        return el;
      }
      case 'Image': {
        var el = document.createElement('img');
        el.className = 'a2ui-img';
        el.src = String(resolveVal(c.url) ?? '');
        return el;
      }
      case 'Divider': {
        var el = document.createElement('hr');
        el.className = c.axis === 'vertical' ? 'a2ui-divider-v' : 'a2ui-divider';
        return el;
      }
      case 'Icon': {
        var el = document.createElement('span');
        el.textContent = c.name || '\\u25C6';
        el.style.fontSize = '16px';
        return el;
      }
      case 'CheckBox': {
        var label = document.createElement('label');
        label.className = 'a2ui-checkbox';
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.style.accentColor = 'var(--primary)';
        var bindVal = resolveVal(c.value);
        if (bindVal === true) input.checked = true;
        input.onchange = function() {
          if (c.action) handleAction(c.action);
        };
        label.appendChild(input);
        label.appendChild(document.createTextNode(' ' + String(resolveVal(c.label) ?? '')));
        return label;
      }
      case 'Slider': {
        var el = document.createElement('input');
        el.type = 'range';
        el.className = 'a2ui-slider';
        el.min = c.min || 0;
        el.max = c.max || 100;
        el.value = resolveVal(c.value) || 50;
        return el;
      }
      case 'ChoicePicker': {
        var el = document.createElement('div');
        el.className = 'a2ui-choice';
        var opts = c.options || [];
        var currentVal = resolveVal(c.value);
        opts.forEach(function(o, i) {
          var btn = document.createElement('button');
          var oval = typeof o === 'string' ? o : (o.value || o.label || String(o));
          var olabel = typeof o === 'string' ? o : (o.label || String(o));
          btn.textContent = olabel;
          if (currentVal === oval) btn.classList.add('selected');
          btn.onclick = function(e) {
            e.stopPropagation();
            // 移除同组选中
            el.querySelectorAll('button').forEach(function(b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            if (c.action) handleAction(c.action);
            else {
              selectedValues[c.id] = oval;
              showToast('☑ ' + olabel);
            }
          };
          el.appendChild(btn);
        });
        return el;
      }
      case 'Tabs': {
        var el = document.createElement('div');
        var tabState = { active: 0 };
        var bar = document.createElement('div');
        bar.className = 'a2ui-choice';
        var panels = [];
        (c.tabs || []).forEach(function(t, i) {
          var tabBtn = document.createElement('button');
          tabBtn.textContent = t.title || ('Tab ' + (i+1));
          if (i === 0) tabBtn.classList.add('selected');
          tabBtn.onclick = function() {
            bar.querySelectorAll('button').forEach(function(b) { b.classList.remove('selected'); });
            tabBtn.classList.add('selected');
            panels.forEach(function(p, j) { p.style.display = j === i ? '' : 'none'; });
          };
          bar.appendChild(tabBtn);
          var panel = document.createElement('div');
          panel.style.paddingTop = '6px';
          if (t.child) panel.appendChild(buildChild(t.child));
          if (i > 0) panel.style.display = 'none';
          panels.push(panel);
        });
        el.appendChild(bar);
        panels.forEach(function(p) { el.appendChild(p); });
        return el;
      }
      default: {
        var el = document.createElement('div');
        el.style.fontSize = '9px';
        el.style.color = '#71717a';
        el.textContent = '[' + c.component + ']';
        return el;
      }
    }
  }

  // —— 初始渲染 ——
  renderNav();
  renderCurrent();
})();
</script>
</body>
</html>`;
}
