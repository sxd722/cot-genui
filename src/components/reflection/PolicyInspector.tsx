"use client";

import { PIPELINE_STEPS } from "@/lib/pipelineTypes";
import { selectStablePolicy } from "@/lib/adaptive/policy";
import { useInferStore } from "@/store/useInferStore";
import { FEATURE_FLAGS } from "@/lib/featureFlags";

export function PolicyInspector() {
  const { queryClassification, profileDigest, stablePolicies, learningSettings, setLearningMode, rollbackAdaptivePolicy } = useInferStore();
  const effective = selectStablePolicy({ classification: queryClassification, userKey: profileDigest?.contextHash, stablePolicies });
  const history = stablePolicies.filter((policy) => policy.taskFamily === queryClassification.taskFamily).sort((left, right) => right.version - left.version);
  return <details className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[10px] dark:border-zinc-800 dark:bg-zinc-950">
    <summary className="cursor-pointer font-medium">Policy Inspector · {queryClassification.taskFamily} / {queryClassification.decisionMode}</summary>
    <div className="mt-3 space-y-3">
      <fieldset><legend className="font-medium">Learning</legend><label className="mr-4"><input type="radio" checked={learningSettings.learningMode === "manual"} onChange={() => void setLearningMode("manual")} /> Manual</label><label><input type="radio" disabled={!FEATURE_FLAGS.GUARDED_AUTO_LEARN} checked={learningSettings.learningMode === "guarded-auto"} onChange={() => void setLearningMode("guarded-auto")} /> Guarded Auto</label><p className="mt-1 text-zinc-400">只有重复出现且高置信的同类反馈才会自动更新；所有版本可回滚。{!FEATURE_FLAGS.GUARDED_AUTO_LEARN ? " 当前 rollout flag 未开放自动应用。" : ""}</p></fieldset>
      <div><strong>Effective policy:</strong> {effective ? `${effective.scope} ${effective.taskFamily ?? "global"} v${effective.version}` : `default ${queryClassification.taskFamily}`}</div>
      {effective ? <div><strong>Profile overlay</strong><p className="rounded bg-white p-1.5 dark:bg-black">{effective.profileOverlay || "（无）"}</p><strong className="mt-2 block">Step hints</strong>{PIPELINE_STEPS.map((step) => <p key={step}><code>{step}</code>：{effective.stepHints[step] || "（继承默认）"}</p>)}</div> : null}
      {history.length ? <div><strong>历史版本</strong><div className="mt-1 flex flex-wrap gap-1">{history.map((policy) => <button key={policy.id} type="button" disabled={policy.id === effective?.id} onClick={() => void rollbackAdaptivePolicy(policy.id)} className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700">{policy.scope} v{policy.version}{policy.id === effective?.id ? " · 当前" : " · Rollback"}</button>)}</div></div> : null}
    </div>
  </details>;
}
