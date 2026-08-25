"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Renderer, type ActionEvent, type OpenUIError, type ParseResult } from "@openuidev/react-lang";
import type { CardPlan, IRAction } from "@/dsl/modules";
import { cotGenUILibrary } from "@/openui/library";
import { useInferStore, type OpenUIStreamMetrics } from "@/store/useInferStore";
import type { AssetManifest, AssetResolutionDiagnostics } from "@/openui/assetTypes";
import type { OpenUIAssetUsageMetrics } from "@/openui/qualityMetrics";
import { AssetRegistryProvider } from "@/openui/assetContext";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { cardPlanLayoutMode } from "@/openui/layoutPolicy";
import type { OpenUILayoutCoverage } from "@/openui/layoutValidation";
import type { OpenUILayoutMeasurement } from "@/openui/layoutRuntime";

interface OpenUIRendererProps {
  code: string;
  cardPlan: CardPlan;
  isStreaming: boolean;
  assetManifest?: AssetManifest | null;
  assetResolutionDiagnostics?: AssetResolutionDiagnostics;
  assetUsage?: OpenUIAssetUsageMetrics;
  layoutCoverage?: OpenUILayoutCoverage;
}

function resolveAction(cardPlan: CardPlan, message: string): { action: IRAction; cardId: string } | null {
  const match = message.match(/^plan:([^:]+):(.+)$/);
  if (!match) return null;
  try {
    const cardId = decodeURIComponent(match[1]);
    const actionId = decodeURIComponent(match[2]);
    const card = cardPlan.cards.find((candidate) => candidate.id === cardId);
    const action = card?.actions?.find((candidate) => candidate.id === actionId);
    return action ? { action, cardId } : null;
  } catch {
    return null;
  }
}

function safeExternalUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function relativeMetric(metrics: OpenUIStreamMetrics, timestamp: number | undefined): string {
  if (metrics.requestStartedAt === undefined || timestamp === undefined) return "—";
  return `${Math.max(0, Math.round(timestamp - metrics.requestStartedAt))}ms`;
}

export function OpenUIRenderer({ code, cardPlan, isStreaming, assetManifest, assetResolutionDiagnostics, assetUsage, layoutCoverage }: OpenUIRendererProps) {
  const [errors, setErrors] = useState<OpenUIError[]>([]);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [layoutOverflowCardIds, setLayoutOverflowCardIds] = useState<string[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const layoutMode = cardPlanLayoutMode(cardPlan);
  const streamMetrics = useInferStore((state) => state.openuiStreamMetrics);
  const markFirstRenderableRoot = useInferStore((state) => state.markOpenUIFirstRenderableRoot);
  const layoutStabilization = useInferStore((state) => state.layoutStabilization);
  const reportOpenUILayout = useInferStore((state) => state.reportOpenUILayout);
  const isTargeting = useInferStore((state) => state.isTargeting);
  const setCardEditTarget = useInferStore((state) => state.setCardEditTarget);

  const status = useMemo(() => {
    if (isStreaming) return `流式生成 · ${code.length} 字`;
    if (layoutMode === "fixed-600x300" && (layoutStabilization.status === "repairing" || layoutStabilization.status === "measuring" || layoutStabilization.status === "idle")) return "正在优化布局";
    if (layoutMode === "fixed-600x300" && layoutStabilization.status === "error") return "固定布局未稳定";
    if (errors.length) return `${errors.length} 个渲染诊断`;
    if (!parseResult?.root) return "等待可渲染 root";
    return `${parseResult.meta.statementCount} 条语句 · 可编译`;
  }, [code.length, errors.length, isStreaming, layoutMode, layoutStabilization.status, parseResult]);

  const timingStatus = useMemo(() => [
    `bootstrap ${relativeMetric(streamMetrics, streamMetrics.bootstrapReceivedAt)}`,
    `首 delta ${relativeMetric(streamMetrics, streamMetrics.firstDeltaAt)}`,
    `首 root ${relativeMetric(streamMetrics, streamMetrics.firstRenderableRootAt)}`,
    `done ${relativeMetric(streamMetrics, streamMetrics.doneAt)}`,
  ].join(" · "), [streamMetrics]);

  const handleParseResult = useCallback((result: ParseResult | null) => {
    setParseResult(result);
    if (result?.root) markFirstRenderableRoot();
  }, [markFirstRenderableRoot]);

  const handleAction = useCallback((event: ActionEvent) => {
    const resolved = resolveAction(cardPlan, event.humanFriendlyMessage);
    if (!resolved) {
      setFeedback("已拦截未绑定到 CardPlan 的动作");
      return;
    }
    const { action } = resolved;
    if (action.type === "external-link") {
      const url = safeExternalUrl(action.link);
      if (!url) {
        setFeedback("链接未通过 http(s) 安全校验");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      setFeedback(`已打开：${action.label}`);
      return;
    }
    if (action.type === "copy") {
      void navigator.clipboard.writeText(action.copyText ?? action.writeValue ?? "");
      setFeedback(`已复制：${action.label}`);
      return;
    }
    if (action.type === "navigate" && action.targetCardId) {
      setFeedback(`导航到卡片：${action.targetCardId}`);
      return;
    }
    setFeedback(`已触发：${action.label}`);
  }, [cardPlan]);

  const captureTarget = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isTargeting) return;
    const origin = event.target as HTMLElement | null;
    const card = origin?.closest<HTMLElement>("[data-card-id]");
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = card.getBoundingClientRect();
    const textHost = origin?.closest<HTMLElement>("button, a, [role], h1, h2, h3, p, li, span") ?? origin;
    const role = textHost?.getAttribute("role");
    const elementHint = [textHost?.tagName.toLowerCase(), role ? `role=${role}` : "", textHost?.getAttribute("aria-label") ?? ""]
      .filter(Boolean).join(" · ").slice(0, 160);
    setCardEditTarget({
      cardId: card.dataset.cardId ?? "",
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))),
      pixelX: Math.round(event.clientX - bounds.left),
      pixelY: Math.round(event.clientY - bounds.top),
      nearbyText: (textHost?.innerText || card.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240),
      elementHint,
    });
  }, [isTargeting, setCardEditTarget]);

  useEffect(() => {
    if (layoutMode !== "fixed-600x300" || isStreaming || !hostRef.current) {
      setLayoutOverflowCardIds([]);
      return;
    }
    const host = hostRef.current;
    let frame = 0;
    let disposed = false;
    let measurementSequence = 0;
    const waitForStableResources = async () => {
      try { await document.fonts?.ready; } catch { /* browser font readiness is best effort */ }
      const images = [...host.querySelectorAll<HTMLImageElement>("img")];
      const decoded = Promise.all(images.map(async (image) => {
        if (image.complete) {
          try { await image.decode(); } catch { /* broken images retain their bounded placeholder area */ }
          return;
        }
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }));
      await Promise.race([decoded, new Promise<void>((resolve) => window.setTimeout(resolve, 1500))]);
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      const sequence = ++measurementSequence;
      frame = requestAnimationFrame(() => void (async () => {
        await waitForStableResources();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (disposed || sequence !== measurementSequence) return;
        const measurements: OpenUILayoutMeasurement[] = [...host.querySelectorAll<HTMLElement>("[data-card-id]")].map((card) => {
          const body = card.querySelector<HTMLElement>(".openui-generated-card__body");
          const header = card.querySelector<HTMLElement>(".openui-generated-card__header");
          const overflow = card.scrollHeight > card.clientHeight + 2
            || card.scrollWidth > card.clientWidth + 2
            || !!header && (header.scrollHeight > header.clientHeight + 2 || header.scrollWidth > header.clientWidth + 2)
            || !!body && (body.scrollHeight > body.clientHeight + 2 || body.scrollWidth > body.clientWidth + 2);
          card.dataset.layoutOverflow = overflow ? "true" : "false";
          const componentTypes = [...card.querySelectorAll<HTMLElement>("[class*='openui-fixed-']")]
            .flatMap((element) => [...element.classList].filter((name) => name.startsWith("openui-fixed-")))
            .filter((name, index, all) => all.indexOf(name) === index);
          return {
            cardId: card.dataset.cardId ?? "unknown",
            clientWidth: card.clientWidth,
            clientHeight: card.clientHeight,
            scrollWidth: card.scrollWidth,
            scrollHeight: card.scrollHeight,
            bodyClientHeight: body?.clientHeight ?? 0,
            bodyScrollHeight: body?.scrollHeight ?? 0,
            headerClientHeight: header?.clientHeight ?? 0,
            headerScrollHeight: header?.scrollHeight ?? 0,
            overflowing: overflow,
            componentTypes,
          };
        });
        const overflowing = measurements.filter((measurement) => measurement.overflowing).map((measurement) => measurement.cardId);
        setLayoutOverflowCardIds((current) => current.join("\u0000") === overflowing.join("\u0000") ? current : overflowing);
        if (measurements.length) void reportOpenUILayout(measurements);
      })());
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    host.querySelectorAll<HTMLElement>("[data-card-id]").forEach((card) => observer.observe(card));
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [code, isStreaming, layoutMode, parseResult, reportOpenUILayout]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-black">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 px-3 py-2 text-[10px] text-zinc-400">
        <span>OpenUI Lang v0.5</span>
        <span className="min-w-0 text-right">
          <span className={errors.length && !isStreaming ? "block text-amber-400" : "block text-emerald-400"}>{status}</span>
          <span className="block truncate text-[9px] text-zinc-500">{timingStatus}</span>
        </span>
      </div>
      {feedback && (
        <button
          type="button"
          onClick={() => setFeedback("")}
          className="mx-3 mt-2 shrink-0 rounded-lg border border-cyan-900/60 bg-cyan-950/40 px-2 py-1.5 text-left text-[10px] text-cyan-300"
        >
          {feedback}
        </button>
      )}
      <div
        ref={hostRef}
        className={`openui-host flex-1 bg-zinc-50 p-3 text-zinc-900 ${layoutMode === "fixed-600x300" ? "overflow-y-hidden" : "overflow-y-auto"} ${isTargeting ? "openui-host--targeting" : ""}`}
        data-card-layout={layoutMode}
        data-layout-stabilization={layoutMode === "fixed-600x300" ? layoutStabilization.status : undefined}
        data-local-bindings={FEATURE_FLAGS.OPENUI_LOCAL_BINDINGS ? "enabled" : "disabled"}
        onPointerDownCapture={captureTarget}
      >
        {!code && isStreaming ? (
          <div className="flex min-h-48 items-center justify-center">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-cyan-500" />
              正在接收 OpenUI 流…
            </div>
          </div>
        ) : (
          <AssetRegistryProvider manifest={assetManifest}>
            <Renderer
              response={code || null}
              library={cotGenUILibrary}
              isStreaming={isStreaming}
              onAction={handleAction}
              onParseResult={handleParseResult}
              onError={setErrors}
              toolProvider={null}
            />
          </AssetRegistryProvider>
        )}
      </div>
      {!isStreaming && errors.length > 0 && (
        <details className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-[10px] text-amber-300">
          <summary className="cursor-pointer">渲染诊断 ({errors.length})</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {errors.map((error, index) => <li key={`${error.code}-${index}`}>{error.message}</li>)}
          </ul>
        </details>
      )}
      {process.env.NODE_ENV === "development" && !isStreaming && assetResolutionDiagnostics && (
        <details
          className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-[10px] text-zinc-300"
          data-asset-provider-state={assetResolutionDiagnostics.providerState}
        >
          <summary className="cursor-pointer text-zinc-400">
            媒体解析 · {assetResolutionDiagnostics.providerState} · requests {assetResolutionDiagnostics.requests} · synthesized {assetResolutionDiagnostics.synthesized ?? 0} · candidates {assetResolutionDiagnostics.candidates} · accepted {assetResolutionDiagnostics.accepted} · required {assetResolutionDiagnostics.required ?? 0} · used {assetResolutionDiagnostics.used ?? 0} · repaired {assetResolutionDiagnostics.repaired ? "yes" : "no"} · cards {assetUsage?.cardsUsingAssets ?? 0}/{assetUsage?.cardsWithAvailableAssets ?? 0} · rejected {assetResolutionDiagnostics.rejected}
          </summary>
          <div className="mt-1 text-zinc-500">provider: {assetResolutionDiagnostics.providerKind}</div>
          {assetUsage?.diagnosticCode ? <div className="mt-1 text-amber-300/90">{assetUsage.diagnosticCode}</div> : null}
          {assetUsage?.unusedAssetRefs.length ? <div className="mt-1 break-all text-zinc-500">unused: {assetUsage.unusedAssetRefs.join(", ")}</div> : null}
          {assetResolutionDiagnostics.events.length > 0 && (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-amber-300/90">
              {assetResolutionDiagnostics.events.map((event, index) => (
                <li key={`${event.stage}-${event.requestId ?? "global"}-${event.candidateIndex ?? "none"}-${index}`}>
                  [{event.stage}] {event.requestId ? `${event.requestId} ` : ""}{event.candidateIndex !== undefined ? `candidate ${event.candidateIndex + 1} ` : ""}{event.reason}{event.statusCode ? ` (HTTP ${event.statusCode})` : ""}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      {process.env.NODE_ENV === "development" && !isStreaming && layoutMode === "fixed-600x300" && (
        <details className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-[10px] text-zinc-300">
          <summary className={layoutOverflowCardIds.length ? "cursor-pointer text-amber-300" : "cursor-pointer text-emerald-400"}>
            固定布局 · 600×300 · planned {layoutStabilization.planned.withinBudget}/{layoutStabilization.planned.total || cardPlan.cards.length} · static {layoutCoverage?.withinBudget ?? layoutStabilization.static.withinBudget}/{layoutCoverage?.checkedCards ?? (layoutStabilization.static.total || cardPlan.cards.length)} · measured {layoutStabilization.measured.withinBudget}/{layoutStabilization.measured.total || cardPlan.cards.length} · repaired {layoutStabilization.repairSucceeded ? 1 : 0} · fallback {layoutStabilization.fallbackCardIds.length}
          </summary>
          {layoutCoverage?.violations.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-amber-300/90">
              {layoutCoverage.violations.map((violation) => <li key={violation.cardId}>{violation.cardId}: {violation.reasons.join("；")}</li>)}
            </ul>
          ) : null}
          {layoutOverflowCardIds.length ? (
            <div className="mt-1 break-all text-amber-300/90">正在处理溢出：{layoutOverflowCardIds.join(", ")}</div>
          ) : (
            <div className="mt-1 text-zinc-500">所有卡片均通过浏览器实际尺寸检查；未追加模型调用。</div>
          )}
          {layoutStabilization.error ? <div className="mt-1 text-amber-300/90">{layoutStabilization.error}</div> : null}
        </details>
      )}
    </div>
  );
}
