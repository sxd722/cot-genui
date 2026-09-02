"use client";

import { useState } from "react";
import type { StitchArtifact, StitchJobProgress } from "@/stitch/types";

/**
 * Render host-fetched Stitch HTML unchanged in an unrestricted demo iframe.
 * The screenshot remains a manual fallback for provider HTML incompatibility.
 */
const PHASE_LABELS: Record<string, string> = {
  queued: "等待执行器",
  generating: "Stitch 正在设计界面",
  "fetching-html": "正在获取 H5",
  finalizing: "正在保存结果",
  complete: "已完成",
};

export function StitchPreview({ artifact, loading, error, progress, onCancel }: {
  artifact: StitchArtifact | null;
  loading: boolean;
  error?: string | null;
  progress?: StitchJobProgress | null;
  onCancel?: () => void;
}) {
  const [previewMode, setPreviewMode] = useState<"html" | "image">("html");

  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="text-sm text-zinc-300">{loading ? (PHASE_LABELS[progress?.phase ?? "queued"] ?? "Stitch 正在生成 H5…") : "执行第⑥步后显示 Stitch H5"}</div>
          {loading && progress ? <div className="text-xs text-zinc-500">{Math.round(progress.elapsedMs / 1000)} 秒 · {progress.jobId}</div> : null}
          {loading && onCancel ? <button type="button" onClick={onCancel} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">取消任务</button> : null}
          {error ? <div className="max-w-lg text-xs text-red-400">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2 text-[10px] text-zinc-400">
        <span>Stitch H5 · {artifact.model}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPreviewMode("html")} className={previewMode === "html" ? "text-white" : "hover:text-zinc-200"}>HTML</button>
          {artifact.imageUrl ? (
            <button type="button" onClick={() => setPreviewMode("image")} className={previewMode === "image" ? "text-white" : "hover:text-zinc-200"}>截图</button>
          ) : null}
          <span>{artifact.htmlBytes} bytes · {artifact.durationMs}ms</span>
        </div>
      </div>
      {previewMode === "image" && artifact.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Stitch 远程截图 URL 是运行时动态地址，next/image 需要预配置远程域名，MVP 兜底直接用 img
        <img src={artifact.imageUrl} alt="Stitch generated UI" referrerPolicy="no-referrer" className="min-h-0 flex-1 object-contain" />
      ) : (
        <iframe
          title="Stitch generated UI"
          srcDoc={artifact.htmlSource}
          referrerPolicy="no-referrer"
          className="min-h-0 flex-1 border-0 bg-white"
        />
      )}
    </div>
  );
}
