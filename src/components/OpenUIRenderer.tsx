"use client";

import { useCallback, useMemo, useState } from "react";
import { Renderer, type ActionEvent, type OpenUIError, type ParseResult } from "@openuidev/react-lang";
import type { CardPlan, IRAction } from "@/dsl/modules";
import { cotGenUILibrary } from "@/openui/library";
import { useInferStore, type OpenUIStreamMetrics } from "@/store/useInferStore";
import type { AssetManifest, AssetResolutionDiagnostics } from "@/openui/assetTypes";
import { AssetRegistryProvider } from "@/openui/assetContext";
import { FEATURE_FLAGS } from "@/lib/featureFlags";

interface OpenUIRendererProps {
  code: string;
  cardPlan: CardPlan;
  isStreaming: boolean;
  assetManifest?: AssetManifest | null;
  assetResolutionDiagnostics?: AssetResolutionDiagnostics;
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

export function OpenUIRenderer({ code, cardPlan, isStreaming, assetManifest, assetResolutionDiagnostics }: OpenUIRendererProps) {
  const [errors, setErrors] = useState<OpenUIError[]>([]);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const streamMetrics = useInferStore((state) => state.openuiStreamMetrics);
  const markFirstRenderableRoot = useInferStore((state) => state.markOpenUIFirstRenderableRoot);
  const isTargeting = useInferStore((state) => state.isTargeting);
  const setCardEditTarget = useInferStore((state) => state.setCardEditTarget);

  const status = useMemo(() => {
    if (isStreaming) return `流式生成 · ${code.length} 字`;
    if (errors.length) return `${errors.length} 个渲染诊断`;
    if (!parseResult?.root) return "等待可渲染 root";
    return `${parseResult.meta.statementCount} 条语句 · 可编译`;
  }, [code.length, errors.length, isStreaming, parseResult]);

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
        className={`openui-host flex-1 overflow-y-auto bg-zinc-50 p-3 text-zinc-900 ${isTargeting ? "openui-host--targeting" : ""}`}
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
            媒体解析 · {assetResolutionDiagnostics.providerState} · requests {assetResolutionDiagnostics.requests} · candidates {assetResolutionDiagnostics.candidates} · accepted {assetResolutionDiagnostics.accepted} · rejected {assetResolutionDiagnostics.rejected}
          </summary>
          <div className="mt-1 text-zinc-500">provider: {assetResolutionDiagnostics.providerKind}</div>
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
    </div>
  );
}
