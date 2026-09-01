import { createReuseExecutionPlan, summarizeExecutionPlan } from "../src/learning/reuseAccelerator";

const coldBaseline = { promptTokens: 9_000, completionTokens: 1_200, durationMs: 12_000 };
const scenarios = [
  createReuseExecutionPlan({ tier: "exact-replay", weakModel: "groq_qwen_3_6_27b", reasons: ["benchmark"] }),
  createReuseExecutionPlan({ tier: "relevant-exact", weakModel: "groq_qwen_3_6_27b", profileSimilarity: 1, reasons: ["benchmark"] }),
  createReuseExecutionPlan({ tier: "profile-compatible", weakModel: "glm_4_7_flash", profileSimilarity: 0.9, reasons: ["benchmark"] }),
  createReuseExecutionPlan({ tier: "skill-only", weakModel: "groq_qwen_3_6_27b", reasons: ["benchmark"] }),
];

const estimates = scenarios.map((plan) => {
  const calls = summarizeExecutionPlan(plan);
  const ratio = plan.tier === "exact-replay" ? 0 : plan.tier === "relevant-exact" ? 0.2 : plan.tier === "profile-compatible" ? 0.55 : 0.75;
  return {
    tier: plan.tier,
    ...calls,
    estimatedPromptTokens: Math.round(coldBaseline.promptTokens * ratio),
    estimatedPromptSavings: `${Math.round((1 - ratio) * 100)}%`,
  };
});

process.stdout.write(`${JSON.stringify({ coldBaseline, estimates }, null, 2)}\n`);

