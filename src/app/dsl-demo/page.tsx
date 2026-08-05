"use client";

import { DslCardHost } from "@/components/dsl/DslCardHost";
import { travelSampleArtifact } from "@/dsl/sample";

/**
 * 临时 demo 页：用内置 sample artifact 验证 DSL 渲染引擎。
 * 后续接入 GLM 生成后会移除，或改为开发调试入口。
 */
export default function DslDemoPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-white">
      <header className="border-b border-white/10 px-4 py-3">
        <h1 className="text-sm font-semibold">DSL 卡片渲染引擎 · Demo</h1>
        <p className="text-[11px] text-white/50">
          内置旅行 sample artifact，验证 DSL → 可交互 web 卡片
        </p>
      </header>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-2 p-4">
        {/* 卡片预览区固定宽度，模拟 4x4 比例 */}
        <div className="flex-1" style={{ minHeight: "460px" }}>
          <DslCardHost artifact={travelSampleArtifact} />
        </div>
        <p className="text-center text-[10px] text-white/30">
          点击底部按钮触发 Flow 流转 · choice 选交通方式 · progress 查看进度
        </p>
      </div>
    </div>
  );
}
