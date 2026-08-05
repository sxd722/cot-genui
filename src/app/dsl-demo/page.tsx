"use client";

import { useMemo, useState } from "react";
import { DslCardHost } from "@/components/dsl/DslCardHost";
import { compileCardPlan } from "@/dsl/compiler";
import { validateArtifact } from "@/dsl/validate";
import { scenarios } from "@/dsl/scenarios";
import housingArtifact from "@/dsl/housing-artifact.json";

/** 所有可选场景：IR 编译型 + 预编译 artifact 型 */
interface DemoScenario {
  id: string;
  label: string;
  description: string;
  /** IR 编译型 */
  plan?: import("@/dsl/modules").CardPlan;
  /** 预编译 artifact 型 */
  artifact?: unknown;
  source: "glm" | "ir";
}

const allScenarios: DemoScenario[] = [
  ...scenarios.map((s) => ({ ...s, source: "ir" as const })),
  {
    id: "housing",
    label: "购房规划",
    description: "GLM真实生成·上海改善置换（6卡含数据流）",
    artifact: housingArtifact,
    source: "glm" as const,
  },
];

/**
 * DSL 渲染引擎 Demo：选场景 → 编译 IR / 加载预编译 → 校验 → 渲染。
 */
export default function DslDemoPage() {
  const [scenarioId, setScenarioId] = useState(allScenarios[0].id);
  const scenario = allScenarios.find((s) => s.id === scenarioId)!;

  // 编译或加载 artifact
  const compiled = useMemo<{ artifact: unknown; notices: import("@/dsl/modules").CompileNotice[] }>(() => {
    if (scenario.artifact) {
      return { artifact: scenario.artifact, notices: [] };
    }
    return compileCardPlan(scenario.plan!);
  }, [scenario]);
  // 校验产出的 artifact
  const validation = useMemo(() => validateArtifact(compiled.artifact), [compiled]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-white">
      <header className="border-b border-white/10 px-4 py-3">
        <h1 className="text-sm font-semibold">DSL 卡片渲染引擎 · 场景验证</h1>
        <p className="text-[11px] text-white/50">
          选场景 → 编译 IR → 校验 → 渲染。观察不同场景的渲染效果与降级处理。
        </p>
      </header>

      {/* 场景切换 */}
      <div className="flex flex-wrap gap-1.5 border-b border-white/10 px-4 py-2.5">
        {allScenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => setScenarioId(s.id)}
            className={`rounded-full border px-3 py-1 text-[11px] transition-all ${
              s.id === scenarioId
                ? "border-[#D7AE59] bg-[#D7AE59] text-black"
                : "border-white/20 text-white/70 hover:border-white/40"
            }`}
          >
            {s.source === "glm" && "🤖 "}
            {s.label}
          </button>
        ))}
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-4 p-4">
        {/* 左：卡片渲染区 */}
        <div className="flex w-[340px] shrink-0 flex-col">
          <div className="mb-1.5 text-[10px] text-white/40">{scenario.description}</div>
          <div className="flex-1" style={{ minHeight: "480px" }}>
            {/* key 强制场景切换时重建组件，重置 currentCardId */}
            <DslCardHost
              key={(compiled.artifact as { artifactId?: string })?.artifactId ?? scenarioId}
              artifact={compiled.artifact}
            />
          </div>
        </div>

        {/* 右：编译/校验诊断 */}
        <div className="flex flex-1 flex-col gap-3 overflow-hidden">
          {/* 校验状态 */}
          <div
            className={`rounded-lg border p-3 ${
              validation.valid
                ? "border-emerald-700/40 bg-emerald-950/30"
                : "border-rose-700/40 bg-rose-950/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={validation.valid ? "text-emerald-400" : "text-rose-400"}>
                {validation.valid ? "✓" : "✗"}
              </span>
              <span className="text-xs font-medium">
                {validation.valid ? "校验通过" : `校验失败 · ${validation.errors.length} 处`}
              </span>
            </div>
            {!validation.valid && (
              <ul className="mt-2 flex flex-col gap-0.5">
                {validation.errors.map((e, i) => (
                  <li key={i} className="text-[10px] leading-relaxed text-rose-400">
                    • {e}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 编译诊断 notices */}
          {compiled.notices.length > 0 && (
            <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 p-3">
              <p className="text-xs font-medium text-amber-400">
                编译降级 · {compiled.notices.length} 处
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {compiled.notices.map((n, i) => (
                  <li key={i} className="text-[10px] leading-relaxed text-amber-300/80">
                    <span className="font-mono">[{n.level}]</span> {n.message}
                    {n.location && <span className="text-amber-500"> @ {n.location}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* IR / Artifact 概览 */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-xs font-medium text-white/70">
              {scenario.source === "glm" ? "GLM 生成 Artifact 概览" : "CardPlan IR 概览"}
            </p>
            {scenario.plan ? (
              <>
                <p className="mt-1 text-[10px] text-white/40">{scenario.plan.reasoning}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {scenario.plan.cards.map((c, i) => (
                    <span key={i} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-white/50">
                      {i + 1}.{c.id}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-1 text-[10px] text-white/40">
                {(() => {
                  const a = compiled.artifact as { artifactId?: string; dsl?: { cards?: unknown[] } };
                  return `artifactId: ${a.artifactId ?? "?"} | cards: ${a.dsl?.cards?.length ?? 0} 张`;
                })()}
                <br />
                <span className="text-emerald-400/60">由 GLM 真实生成 · 编译器翻译 · 校验通过</span>
              </p>
            )}
          </div>

          {/* Artifact JSON */}
          <details className="overflow-hidden rounded-lg border border-white/10">
            <summary className="cursor-pointer bg-white/[0.02] px-3 py-2 text-[11px] text-white/60 hover:bg-white/[0.05]">
              查看编译后的 Artifact JSON
            </summary>
            <pre className="max-h-[300px] overflow-auto bg-zinc-900 p-2 text-[9px] leading-relaxed text-zinc-400">
              {JSON.stringify(compiled.artifact, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
