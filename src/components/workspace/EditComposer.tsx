"use client";

import { useInferStore } from "@/store/useInferStore";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { CARD_EDIT_MODEL_PROFILES, type CardEditModelProfile } from "@/lib/cardEditingTypes";
import { MODEL_PROFILE_LABELS } from "@/lib/pipelineTypes";

export function EditComposer() {
  const state = useInferStore();
  const layoutReady = state.layoutMode !== "fixed-600x300" || state.layoutStabilization.stable;
  const canEdit = FEATURE_FLAGS.OPENUI_CARD_EDIT && !!state.openuiCode && state.steps.openui_generate.status === "done" && layoutReady;
  const canUndo = layoutReady && state.openuiVersionIndex > 0;
  const canRedo = layoutReady && state.openuiVersionIndex >= 0 && state.openuiVersionIndex < state.openuiVersions.length - 1;
  const canRecordFeedback = !!state.currentEpisode && state.currentEpisode.status !== "accepted" && !!state.openuiCode && !!state.overallFeedbackDraft.trim();
  return (
    <section className="relative flex min-h-0 flex-col gap-2 overflow-y-auto bg-white p-3 dark:bg-black">
      <div className="flex items-center gap-2">
        <strong className="text-xs">卡片局部编辑</strong>
        {!FEATURE_FLAGS.OPENUI_CARD_EDIT ? <span className="text-[10px] text-zinc-400">feature flag 已关闭</span> : null}
        {!layoutReady ? <span className="text-[10px] text-amber-500">{state.layoutStabilization.status === "error" ? "布局未能稳定" : "正在优化布局"}</span> : null}
        <label className="flex items-center gap-1 text-[10px] text-zinc-500">
          二次编辑模型
          <select
            value={state.cardEditModelProfile}
            disabled={state.editStatus === "streaming"}
            onChange={(event) => state.setCardEditModelProfile(event.target.value as CardEditModelProfile)}
            className="rounded border border-zinc-300 bg-white px-1.5 py-1 text-[10px] text-zinc-700 outline-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {CARD_EDIT_MODEL_PROFILES.map((profile) => <option key={profile} value={profile}>{MODEL_PROFILE_LABELS[profile]}</option>)}
          </select>
        </label>
        <button type="button" disabled={!canEdit || state.editStatus === "streaming"} onClick={() => state.setTargeting(!state.isTargeting)} className={`rounded border px-2 py-1 text-[10px] disabled:opacity-40 ${state.isTargeting ? "border-cyan-500 bg-cyan-500 text-black" : "border-zinc-300 dark:border-zinc-700"}`}>{state.isTargeting ? "请点击卡片位置…" : "⌖ 点选位置"}</button>
        <button type="button" onClick={state.undoOpenUIEdit} disabled={!canUndo} className="rounded border border-zinc-300 px-2 py-1 text-[10px] disabled:opacity-30 dark:border-zinc-700">撤销</button>
        <button type="button" onClick={state.redoOpenUIEdit} disabled={!canRedo} className="rounded border border-zinc-300 px-2 py-1 text-[10px] disabled:opacity-30 dark:border-zinc-700">重做</button>
        <span className="text-[10px] text-zinc-400">版本 {Math.max(0, state.openuiVersionIndex)}/{Math.max(0, state.openuiVersions.length - 1)}</span>
        {state.openuiVersions[state.openuiVersionIndex]?.metrics ? <span className="text-[9px] text-zinc-400">edit {state.openuiVersions[state.openuiVersionIndex].metrics!.latencyMs}ms · prompt {state.openuiVersions[state.openuiVersionIndex].metrics!.promptChars} chars · patch {state.openuiVersions[state.openuiVersionIndex].metrics!.patchChars} chars</span> : null}
        <div className="ml-auto flex gap-1">
          <button type="button" onClick={() => void state.exportLearningJson()} className="rounded border border-zinc-300 px-2 py-1 text-[10px] dark:border-zinc-700">导出学习数据</button>
          <button type="button" disabled={!state.currentEpisode || !canEdit || state.currentEpisode.status === "accepted"} onClick={() => void state.acceptCurrentEpisode()} className="rounded bg-emerald-600 px-3 py-1 text-[10px] font-medium text-white disabled:opacity-30">OK · 接受</button>
        </div>
      </div>
      <div className="flex min-h-0 gap-2">
        <div className="w-52 shrink-0 rounded border border-zinc-200 px-2 py-1 text-[10px] dark:border-zinc-800">
          {state.cardEditTarget ? <><span className="font-medium">{state.cardEditTarget.cardId}</span><p className="truncate text-zinc-500">{state.cardEditTarget.nearbyText || state.cardEditTarget.elementHint || "卡片空白区域"}</p></> : <span className="text-zinc-400">尚未选择目标位置</span>}
        </div>
        <textarea value={state.editDraft} onChange={(event) => state.setEditDraft(event.target.value)} disabled={!canEdit || state.editStatus === "streaming"} placeholder="例如：把这里改成更醒目的价格对比，并保持原动作不变" className="min-h-14 flex-1 resize-none rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-cyan-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900" />
        <button type="button" onClick={() => void state.submitCardEdit()} disabled={!canEdit || !state.cardEditTarget || !state.editDraft.trim() || state.editStatus === "streaming"} className="w-24 rounded bg-zinc-900 px-3 text-xs font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">{state.editStatus === "streaming" ? "编辑中…" : "应用编辑"}</button>
      </div>
      {state.editError ? <p className="text-[10px] text-rose-500">⚠ {state.editError}；当前卡片保持不变。</p> : null}
      {state.editStatus === "streaming" && state.editStreamingPatch ? <p className="truncate font-mono text-[9px] text-cyan-600">patch stream: {state.editStreamingPatch}</p> : null}
      <div className="flex min-h-0 items-stretch gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-900">
        <div className="w-52 shrink-0 text-[10px] text-zinc-500">
          <strong className="block text-zinc-700 dark:text-zinc-300">整体卡片流反馈</strong>
          <span>只记录并供接受后的反思参考，不会立即修改当前结果。</span>
          {state.currentEpisode?.feedback?.length ? <span className="mt-1 block text-emerald-600">已记录 {state.currentEpisode.feedback.length} 条</span> : null}
        </div>
        <textarea maxLength={2000} value={state.overallFeedbackDraft} onChange={(event) => state.setOverallFeedbackDraft(event.target.value)} disabled={!state.currentEpisode || state.currentEpisode.status === "accepted" || state.feedbackStatus === "saving"} placeholder="例如：整体卡片太碎；应先给结论，再展开依据。也可以说明哪些地方做得好。" className="min-h-12 flex-1 resize-none rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-violet-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900" />
        <button type="button" onClick={() => void state.submitOverallFeedback()} disabled={!canRecordFeedback || state.feedbackStatus === "saving"} className="w-24 rounded border border-violet-300 px-2 text-[11px] font-medium text-violet-700 disabled:opacity-30 dark:border-violet-800 dark:text-violet-300">{state.feedbackStatus === "saving" ? "记录中…" : "记录反馈"}</button>
      </div>
      {state.feedbackError ? <p className="text-[10px] text-rose-500">⚠ {state.feedbackError}</p> : state.feedbackStatus === "saved" ? <p className="text-[10px] text-emerald-600">✓ 整体反馈已保存，将在接受结果后的反思中使用。</p> : null}
    </section>
  );
}
