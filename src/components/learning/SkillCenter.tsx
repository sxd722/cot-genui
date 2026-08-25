"use client";

import { useRef, useState } from "react";
import {
  discardSkillCandidate,
  exportSkillPackage,
  importSkillPackage,
  resolveSkillCandidate,
  rollbackSkillVersion,
  setSkillStatus,
} from "@/learning/skillPackage";
import { useInferStore } from "@/store/useInferStore";

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SkillCenter() {
  const { isSkillCenterOpen, setSkillCenterOpen, skills, skillVersions, skillCandidates, refreshSkills } = useInferStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!isSkillCenterOpen) return null;

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await operation(); await refreshSkills(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-6" role="dialog" aria-modal="true" aria-label="Skill Center">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div><h2 className="text-sm font-semibold">Skill Center</h2><p className="text-[11px] text-zinc-500">管理本地流程、版本、导入包和待处理候选</p></div>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void run(async () => importSkillPackage(JSON.parse(await file.text())));
                event.target.value = "";
              }}
            />
            <button disabled={busy} onClick={() => inputRef.current?.click()} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">导入</button>
            <button onClick={() => setSkillCenterOpen(false)} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">关闭</button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <section>
            <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">已存 Skill · {skills.length}</h3>
            <div className="space-y-2">
              {skills.map((skill) => {
                const versions = skillVersions.filter((version) => version.skillId === skill.id).sort((a, b) => b.version - a.version);
                const activeVersion = versions.find((version) => version.id === skill.activeVersionId);
                return (
                  <article key={skill.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-2">
                      <div><p className="text-sm font-medium">{skill.name}</p><p className="text-[10px] text-zinc-500">{skill.status} · v{activeVersion?.version ?? "?"}</p></div>
                      <div className="flex gap-1">
                        <button disabled={busy} onClick={() => void run(async () => download(await exportSkillPackage(skill.id), `${skill.slug}.genui-skill.json`))} className="rounded border px-1.5 py-0.5 text-[10px]">导出</button>
                        <button disabled={busy} onClick={() => void run(() => setSkillStatus(skill.id, skill.status === "active" ? "archived" : "active"))} className="rounded border px-1.5 py-0.5 text-[10px]">{skill.status === "active" ? "停用" : "启用"}</button>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">{skill.description}</p>
                    {activeVersion?.indexProfile.intentKey && (
                      <p className="mt-1 rounded bg-zinc-100 px-1.5 py-1 font-mono text-[10px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                        {activeVersion.indexProfile.intentDisplayName ?? activeVersion.indexProfile.intentKey}
                        ({(activeVersion.indexProfile.parameterKeys ?? []).join(", ")})
                      </p>
                    )}
                    {versions.length > 1 && (
                      <details className="mt-2 text-[10px] text-zinc-500">
                        <summary className="cursor-pointer">{versions.length} 个版本</summary>
                        <div className="mt-1 space-y-1">
                          {versions.map((version) => <div key={version.id} className="flex items-center justify-between"><span>v{version.version} · {version.status} · {version.exampleIds.length} examples</span>{version.id !== skill.activeVersionId && <button disabled={busy} onClick={() => void run(() => rollbackSkillVersion(skill.id, version.id))} className="underline">回滚到此版</button>}</div>)}
                        </div>
                      </details>
                    )}
                  </article>
                );
              })}
              {!skills.length && <p className="rounded border border-dashed p-4 text-center text-xs text-zinc-500">接受一个零编辑结果后会自动生成首个 Skill。</p>}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">待处理候选 · {skillCandidates.filter((item) => item.status === "pending-comparison").length}</h3>
            <div className="space-y-2">
              {skillCandidates.filter((item) => item.status === "pending-comparison").map((candidate) => (
                <article key={candidate.id} className="rounded-lg border border-amber-200 p-3 dark:border-amber-900">
                  <p className="text-xs font-medium">{candidate.indexProfile.semanticText || candidate.taskFamilies.join(" · ")}</p>
                  <p className="mt-1 text-[10px] text-zinc-500">{candidate.domains.join(" · ") || "无领域标签"}</p>
                  <div className="mt-2 flex gap-1">
                    <button disabled={busy} onClick={() => void run(() => resolveSkillCandidate({ candidateId: candidate.id, resolution: "new-skill", name: candidate.taskFamilies.join(" · ") || "生成流程" }))} className="rounded bg-zinc-900 px-2 py-1 text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900">发布为新 Skill</button>
                    <button disabled={busy} onClick={() => void run(() => discardSkillCandidate(candidate))} className="rounded border px-2 py-1 text-[10px]">丢弃</button>
                  </div>
                </article>
              ))}
              {!skillCandidates.some((item) => item.status === "pending-comparison") && <p className="rounded border border-dashed p-4 text-center text-xs text-zinc-500">暂无需人工处理的候选。</p>}
            </div>
          </section>
        </div>
        {error && <p className="border-t border-rose-200 px-4 py-2 text-xs text-rose-600 dark:border-rose-900">{error}</p>}
      </div>
    </div>
  );
}
