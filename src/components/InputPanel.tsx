"use client";

import { useEffect } from "react";
import { presets } from "@/lib/presets";
import { useInferStore } from "@/store/useInferStore";
import { PIPELINE_STEPS } from "@/lib/pipelineTypes";
import { STEP_LABEL } from "@/store/useInferStore";

export function InputPanel() {
  const {
    query,
    layoutMode,
    setLayoutMode,
    hydrateLayoutMode,
    setQuery,
    deviceContext,
    selectPreset,
    contextText,
    setContextText,
    customContextText,
    setCustomContextText,
    profileStatus,
    profileDigest,
    profileError,
    ensureProfileDigest,
    reset,
    learningSettings,
    skillMatches,
    selectedSkill,
    queryAbstraction,
    skillMatchReport,
    selectedSkillInvocation,
    skillDecisionLocked,
    prepareSkillReuse,
    selectSkillMatch,
    setSkillReuseEnabled,
    setSkillStepReuse,
    setSkillMatchModel,
    setSkillExecutionModel,
    setSkillCenterOpen,
    skillMatchStatus,
    skillMatchError,
    skillMatchDiagnostics,
    reusePlan,
  } = useInferStore();

  useEffect(() => {
    hydrateLayoutMode();
  }, [hydrateLayoutMode]);

  return (
    <aside className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto border-r border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">输入</h2>

      {/* 用户意图 */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          用户意图 (query)
        </span>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={2}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300"
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">卡片布局</span>
        <div className="grid grid-cols-2 rounded-lg border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setLayoutMode("fixed-600x300")}
            aria-pressed={layoutMode === "fixed-600x300"}
            className={`rounded-md px-2 py-1.5 text-xs transition-colors ${layoutMode === "fixed-600x300" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
          >
            固定 600×300
          </button>
          <button
            type="button"
            onClick={() => setLayoutMode("free")}
            aria-pressed={layoutMode === "free"}
            className={`rounded-md px-2 py-1.5 text-xs transition-colors ${layoutMode === "free" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
          >
            自由生成
          </button>
        </div>
        <p className="text-[10px] leading-snug text-zinc-500">
          {layoutMode === "fixed-600x300" ? "第⑤步按固定空间规划；卡内不滚动。" : "由模型按内容自由选择卡片密度与高度。"}
        </p>
      </div>

      <section className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2 text-[11px] dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-300">
            <input
              type="checkbox"
              checked={learningSettings.skillReuseEnabled !== false}
              disabled={skillDecisionLocked}
              onChange={(event) => void setSkillReuseEnabled(event.target.checked)}
            />
            复用历史 Skill
          </label>
          <div className="flex gap-1">
            <button type="button" disabled={skillDecisionLocked || skillMatchStatus === "matching" || learningSettings.skillReuseEnabled === false} onClick={() => void prepareSkillReuse()} className="rounded border border-emerald-300 px-1.5 py-0.5 disabled:opacity-40 dark:border-emerald-800">{skillMatchStatus === "matching" ? "匹配中…" : "匹配"}</button>
            <button type="button" onClick={() => setSkillCenterOpen(true)} className="rounded border border-emerald-300 px-1.5 py-0.5 dark:border-emerald-800">Skill Center</button>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="shrink-0 text-[10px] text-zinc-500">匹配模型</span>
          <select
            value={learningSettings.skillMatchModel ?? "groq_qwen_3_6_27b"}
            disabled={skillDecisionLocked || skillMatchStatus === "matching" || learningSettings.skillReuseEnabled === false}
            onChange={(event) => void setSkillMatchModel(event.target.value as "groq_qwen_3_6_27b" | "glm_5_2")}
            className="min-w-0 flex-1 rounded border border-emerald-200 bg-white px-1.5 py-1 text-[10px] dark:border-emerald-900 dark:bg-zinc-950"
          >
            <option value="groq_qwen_3_6_27b">Qwen 27B · Groq</option>
            <option value="glm_5_2">GLM-5.2</option>
          </select>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="shrink-0 text-[10px] text-zinc-500">增量执行</span>
          <select
            value={learningSettings.skillExecutionModel ?? "groq_qwen_3_6_27b"}
            disabled={skillDecisionLocked || learningSettings.skillReuseEnabled === false}
            onChange={(event) => void setSkillExecutionModel(event.target.value as "groq_qwen_3_6_27b" | "glm_4_7_flash")}
            className="min-w-0 flex-1 rounded border border-emerald-200 bg-white px-1.5 py-1 text-[10px] dark:border-emerald-900 dark:bg-zinc-950"
          >
            <option value="groq_qwen_3_6_27b">Qwen 27B · Groq</option>
            <option value="glm_4_7_flash">GLM-4.7-Flash</option>
          </select>
        </div>
        {reusePlan && (
          <div className="mt-1 rounded bg-emerald-100/70 px-1.5 py-1 text-[9px] text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            <p>
              复用等级 {reusePlan.tier} · 画像 {Math.round(reusePlan.profileSimilarity * 100)}%
              {reusePlan.estimatedSavings ? ` · 冷启动基线 ${reusePlan.estimatedSavings.promptTokens + reusePlan.estimatedSavings.completionTokens} tok` : ""}
            </p>
            {reusePlan.delta && (
              <p className="mt-0.5">
                增量步骤 {reusePlan.delta.affectedSteps.length}/6 · 槽位 {reusePlan.delta.affectedSlotNames.length} · 卡片 {reusePlan.delta.affectedCardIds.length}
                {reusePlan.delta.freshnessRequired ? " · 实时事实需刷新" : ""}
              </p>
            )}
          </div>
        )}
        {selectedSkill ? (
          <p className="mt-1 text-emerald-700 dark:text-emerald-400">
            已{selectedSkill.activation === "auto" ? "自动" : "手动"}锁定 · {Math.round(selectedSkill.score * 100)}% · {skillMatches.find((item) => item.skill.id === selectedSkill.skillId)?.skill.name}
          </p>
        ) : skillMatches.length ? (
          <p className="mt-1 text-amber-700 dark:text-amber-400">发现候选，但模型决策或安全门槛不足以自动应用；可手动选择。</p>
        ) : (
          <p className="mt-1 text-zinc-500">{skillMatchStatus === "matching" ? "正在调用外部模型匹配…" : "外部模型独立决定语义分；本地评分只用于候选预筛，故障时仅提供人工候选。"}</p>
        )}
        {skillMatchError && <p className="mt-1 text-amber-700 dark:text-amber-400">{skillMatchError}</p>}
        {skillMatchDiagnostics && (
          <>
            <p className="mt-1 text-[9px] text-zinc-500">
              候选 {skillMatchDiagnostics.candidateCount}
              {skillMatchDiagnostics.abstractionModel ? ` · 抽象 ${skillMatchDiagnostics.abstractionModel}` : ""}
              {skillMatchDiagnostics.abstractionDurationMs !== undefined ? ` ${skillMatchDiagnostics.abstractionDurationMs}ms` : ""}
              {skillMatchDiagnostics.abstractionPromptTokens !== undefined ? `/${skillMatchDiagnostics.abstractionPromptTokens} tok` : ""}
              {skillMatchDiagnostics.model ? ` · ${skillMatchDiagnostics.model}` : ""}
              {skillMatchDiagnostics.durationMs !== undefined ? ` · ${skillMatchDiagnostics.durationMs}ms` : ""}
              {skillMatchDiagnostics.promptTokens !== undefined ? ` · ${skillMatchDiagnostics.promptTokens} prompt tok` : ""}
            </p>
            {!!skillMatchDiagnostics.decisionLogs?.length && (
              <details className="mt-1 rounded border border-emerald-200 bg-white/70 p-1.5 text-[9px] dark:border-emerald-900 dark:bg-zinc-950/60">
                <summary className="cursor-pointer font-medium text-zinc-600 dark:text-zinc-400">Skill 匹配调试日志</summary>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-zinc-500">
                  {skillMatchDiagnostics.decisionLogs.map((entry, index) => <li key={`${index}-${entry}`} className="break-words">{entry}</li>)}
                </ul>
              </details>
            )}
          </>
        )}
        {skillMatches.length > 0 && !skillDecisionLocked && (
          <select
            value={selectedSkill?.skillId ?? ""}
            onChange={(event) => selectSkillMatch(event.target.value || null)}
            className="mt-1 w-full rounded border border-emerald-200 bg-white px-1.5 py-1 dark:border-emerald-900 dark:bg-zinc-950"
          >
            <option value="">不使用候选 Skill</option>
            {skillMatches.map((match) => <option key={match.skill.id} value={match.skill.id}>{match.skill.name} · {Math.round(match.score * 100)}%{match.matcherModel ? " · LLM" : " · local"}</option>)}
          </select>
        )}
        {queryAbstraction && (
          <details className="mt-1.5 rounded border border-emerald-200 bg-white/70 p-1.5 dark:border-emerald-900 dark:bg-zinc-950/60">
            <summary className="cursor-pointer font-medium text-emerald-800 dark:text-emerald-300">匹配详情 · {queryAbstraction.displayName}{queryAbstraction.parameters.length ? `(${queryAbstraction.parameters.map((parameter) => `${parameter.key}=${parameter.value ?? "?"}`).join(", ")})` : ""}</summary>
            <div className="mt-1.5 space-y-2 text-[10px] text-zinc-600 dark:text-zinc-400">
              <div>
                <p><span className="font-medium">通用意图：</span>{queryAbstraction.intentKey}</p>
                <p><span className="font-medium">不变量：</span>{queryAbstraction.invariantSummary}</p>
                {!!queryAbstraction.constraints.length && <p><span className="font-medium">约束：</span>{queryAbstraction.constraints.join("；")}</p>}
              </div>
              {selectedSkillInvocation && (
                <div className="rounded bg-emerald-50 p-1.5 dark:bg-emerald-950/30">
                  <p className="font-medium text-emerald-800 dark:text-emerald-300">当前调用：{selectedSkillInvocation.displayText}</p>
                  <p>参数映射：{selectedSkillInvocation.bindings.length ? selectedSkillInvocation.bindings.map((binding) => `${binding.currentKey}→${binding.skillKey}${binding.value ? `=${binding.value}` : ""}`).join("；") : "无"}</p>
                  {!!selectedSkillInvocation.missingRequiredKeys.length && <p>待补参数：{selectedSkillInvocation.missingRequiredKeys.join("、")}</p>}
                  {!!selectedSkillInvocation.conflicts.length && <p className="text-amber-700">冲突：{selectedSkillInvocation.conflicts.join("；")}</p>}
                  <p>复用先验：{selectedSkillInvocation.reusableSteps.map((step) => STEP_LABEL[step]).join("、") || "无"}</p>
                  <p>当前重跑：{selectedSkillInvocation.rerunSteps.map((step) => STEP_LABEL[step]).join("、") || "无"}</p>
                </div>
              )}
              {skillMatchReport?.comparisons.map((comparison) => {
                const candidate = skillMatches.find((match) => match.skill.id === comparison.skillId);
                return (
                  <div key={comparison.skillId} className="border-t border-zinc-200 pt-1 dark:border-zinc-800">
                    <p className="font-medium">{candidate?.skill.name ?? comparison.skillId} · {comparison.decision} · 模型 {Math.round(comparison.score * 100)}%</p>
                    <p>{comparison.summary || comparison.reasonCodes.join(" · ") || "模型未提供摘要"}</p>
                    {!!comparison.matchedInvariants.length && <p>命中：{comparison.matchedInvariants.join("、")}</p>}
                    {!!comparison.conflicts.length && <p className="text-amber-700">冲突：{comparison.conflicts.join("；")}</p>}
                    {!!candidate?.autoBlockReasons?.length && <p className="text-amber-700">未自动应用：{candidate.autoBlockReasons.join("；")}</p>}
                    {!!candidate?.decisionNotes?.length && <p className="text-zinc-500">宿主决策：{candidate.decisionNotes.join("；")}</p>}
                  </div>
                );
              })}
              {skillMatchReport?.noMatchReason && <p>未匹配原因：{skillMatchReport.noMatchReason}</p>}
              <details>
                <summary className="cursor-pointer text-zinc-500">模型结构化返回 JSON</summary>
                <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-100 p-1.5 text-[9px] dark:bg-zinc-900">{JSON.stringify({ abstraction: queryAbstraction, matchReport: skillMatchReport }, null, 2)}</pre>
              </details>
              <p className="text-[9px] text-zinc-400">这里展示经 schema 校验的决策依据，不包含模型私有思维链。</p>
            </div>
          </details>
        )}
        <details className="mt-1.5">
          <summary className="cursor-pointer text-zinc-500">逐步复用开关</summary>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {PIPELINE_STEPS.map((step) => (
              <label key={step} className="flex items-center gap-1 text-[10px] text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={learningSettings.skillStepReuse?.[step] ?? true}
                  disabled={skillDecisionLocked || learningSettings.skillReuseEnabled === false}
                  onChange={(event) => void setSkillStepReuse(step, event.target.checked)}
                />
                {STEP_LABEL[step].replace(/^\S+\s/, "")}
              </label>
            ))}
          </div>
        </details>
      </section>

      {/* 预设场景 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          设备上下文预设
        </span>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => selectPreset(p.id)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                deviceContext.id === p.id
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
          {deviceContext.description}
        </p>
      </div>

      <div className="rounded-md border border-zinc-200 bg-white/70 p-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-900/70">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">通用画像索引</span>
          <button
            onClick={() => void ensureProfileDigest()}
            disabled={profileStatus === "compressing"}
            className="rounded border border-zinc-300 px-2 py-0.5 text-[10px] text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400"
          >
            {profileStatus === "compressing" ? "压缩中…" : profileStatus === "ready" ? "已缓存" : profileStatus === "degraded" ? "降级目录" : "生成画像"}
          </button>
        </div>
        {profileError && <p className="mt-1 text-rose-500">{profileError}</p>}
        {profileDigest && (
          <details className="mt-1">
            <summary className="cursor-pointer text-zinc-500">{profileDigest.domains.length} 个领域 · {profileDigest.salientSignals.length} 条显著信号</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-1.5 text-[9px] dark:bg-zinc-950">{JSON.stringify(profileDigest, null, 2)}</pre>
          </details>
        )}
      </div>

      {/* 自定义上下文输入 */}
      <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-2 dark:border-indigo-900 dark:bg-indigo-950/30">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-[11px] text-indigo-700 dark:text-indigo-400">
            ✨ 自定义个人上下文（自由文本）
          </span>
          {customContextText.trim().length > 20 && (
            <button
              onClick={() => void ensureProfileDigest()}
              disabled={profileStatus === "compressing"}
              className="shrink-0 rounded border border-indigo-300 bg-indigo-600 px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50 dark:border-indigo-700"
            >
              {profileStatus === "compressing" ? "深度分析中…" : "🧠 画像索引"}
            </button>
          )}
        </div>
        <textarea
          value={customContextText}
          onChange={(e) => setCustomContextText(e.target.value)}
          placeholder={"用自然语言描述你的个人上下文，例如：\n30岁前端工程师，在上海浦东工作7年，月入2.8万，已婚有个3岁女儿，有房贷，预算敏感但消费风格偏舒适…\n\n默认模型会深度分析这段文本并生成画像索引。"}
          rows={5}
          spellCheck={false}
          className="mt-1.5 w-full resize-y rounded border border-indigo-200 bg-white/80 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-800 outline-none focus:border-indigo-500 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-zinc-200"
        />
        {customContextText.trim().length > 0 && customContextText.trim().length <= 20 && (
          <p className="mt-0.5 text-[9px] text-zinc-400">至少输入 20 字符才能生成画像索引</p>
        )}
        {customContextText.trim().length > 20 && (
          <p className="mt-0.5 text-[9px] text-indigo-400">已输入 {customContextText.trim().length} 字 · 点击“画像索引”用默认 Groq 模型深度分析</p>
        )}
      </div>

      {/* JSON 编辑 */}
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          device_context (JSON, 可编辑)
        </span>
        <textarea
          value={contextText}
          onChange={(e) => setContextText(e.target.value)}
          spellCheck={false}
          className="min-h-[200px] flex-1 rounded-md border border-zinc-300 bg-white p-2 font-mono text-[11px] leading-relaxed text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </label>

      <button
        onClick={reset}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
      >
        重置全部
      </button>
    </aside>
  );
}
