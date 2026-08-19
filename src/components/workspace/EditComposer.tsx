"use client";

import { useInferStore } from "@/store/useInferStore";

export function EditComposer() {
  const state = useInferStore();
  const canEdit = !!state.openuiCode && state.steps.openui_generate.status === "done";
  const canUndo = state.openuiVersionIndex > 0;
  const canRedo = state.openuiVersionIndex >= 0 && state.openuiVersionIndex < state.openuiVersions.length - 1;
  return (
    <section className="relative flex min-h-0 flex-col gap-2 overflow-y-auto bg-white p-3 dark:bg-black">
      <div className="flex items-center gap-2">
        <strong className="text-xs">卡片局部编辑</strong>
        <button type="button" disabled={!canEdit || state.editStatus === "streaming"} onClick={() => state.setTargeting(!state.isTargeting)} className={`rounded border px-2 py-1 text-[10px] disabled:opacity-40 ${state.isTargeting ? "border-cyan-500 bg-cyan-500 text-black" : "border-zinc-300 dark:border-zinc-700"}`}>{state.isTargeting ? "请点击卡片位置…" : "⌖ 点选位置"}</button>
        <button type="button" onClick={state.undoOpenUIEdit} disabled={!canUndo} className="rounded border border-zinc-300 px-2 py-1 text-[10px] disabled:opacity-30 dark:border-zinc-700">撤销</button>
        <button type="button" onClick={state.redoOpenUIEdit} disabled={!canRedo} className="rounded border border-zinc-300 px-2 py-1 text-[10px] disabled:opacity-30 dark:border-zinc-700">重做</button>
        <span className="text-[10px] text-zinc-400">版本 {Math.max(0, state.openuiVersionIndex)}/{Math.max(0, state.openuiVersions.length - 1)}</span>
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
    </section>
  );
}
