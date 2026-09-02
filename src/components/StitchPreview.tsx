"use client";

import { useState } from "react";
import type { StitchArtifact } from "@/stitch/types";

/**
 * Render host-fetched Stitch HTML unchanged in an unrestricted demo iframe.
 * The screenshot remains a manual fallback for provider HTML incompatibility.
 */
export function StitchPreview({ artifact, loading, error }: {
  artifact: StitchArtifact | null;
  loading: boolean;
  error?: string | null;
}) {
  const [previewMode, setPreviewMode] = useState<"html" | "image">("html");

  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="text-sm text-zinc-300">{loading ? "Stitch 正在生成 H5…" : "执行第⑥步后显示 Stitch H5"}</div>
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
          <button type="button" onClick={() => setPreviewMode("image")} className={previewMode === "image" ? "text-white" : "hover:text-zinc-200"}>截图</button>
          <span>{artifact.htmlBytes} bytes · {artifact.durationMs}ms</span>
        </div>
      </div>
      {previewMode === "image" ? (
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
