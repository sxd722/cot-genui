import { writeFile } from "node:fs/promises";
import { GENERATION_EVAL_FIXTURES } from "../src/openui/evalFixtures";
import type { ModelProfile, PipelineStepName, PipelineStepOutput } from "../src/lib/pipelineTypes";

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function post(baseUrl: string, payload: Record<string, unknown>): Promise<PipelineStepOutput> {
  const response = await fetch(`${baseUrl}/api/infer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const value = await response.json() as PipelineStepOutput & { error?: string };
  if (!response.ok || value.error) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

async function evaluateFixture(baseUrl: string, modelProfile: ModelProfile, query: string) {
  const steps: PipelineStepName[] = ["intent_analysis", "evidence_resolution", "clarification", "context_enrichment", "card_plan_generate", "openui_generate"];
  let inferenceState: PipelineStepOutput["inferenceState"];
  let cardPlan: PipelineStepOutput["cardPlan"];
  let userAnswers: Record<number, string> = {};
  let output: PipelineStepOutput | undefined;
  for (const step of steps) {
    output = await post(baseUrl, { query, step, modelProfile, deviceContext: {}, inferenceState, cardPlan, userAnswers });
    inferenceState = output.inferenceState ?? inferenceState;
    cardPlan = output.cardPlan ?? cardPlan;
    if (step === "clarification") userAnswers = Object.fromEntries((output.questions ?? []).map((question, index) => [index, question.options?.[0] ?? "暂不限制"]));
  }
  return output!;
}

async function main() {
  const modelProfile = argument("--model", "groq_qwen_3_6_27b") as ModelProfile;
  const out = argument("--out", "openui-eval.json")!;
  const baseUrl = argument("--base-url", "http://localhost:3000")!;
  const rows = [];
  for (const fixture of GENERATION_EVAL_FIXTURES) {
    const result = await evaluateFixture(baseUrl, modelProfile, fixture.query);
    rows.push({ fixture, result });
  }
  const qualities = rows.map((row) => row.result.openuiDiagnostics?.quality).filter(Boolean);
  const counts = qualities.map((quality) => quality!.cardCount);
  const histogram = Object.fromEntries([...new Set(counts)].sort().map((count) => [count, counts.filter((item) => item === count).length]));
  const simpleRows = rows.filter((row) => row.fixture.expectedTopology.maxCards === 1);
  const aggregate = {
    modelProfile,
    fixtureCount: rows.length,
    cardCountHistogram: histogram,
    threeCardRate: counts.filter((count) => count === 3).length / Math.max(1, counts.length),
    singleGoalOneCardRate: simpleRows.filter((row) => row.result.openuiDiagnostics?.quality?.cardCount === 1).length / Math.max(1, simpleRows.length),
    medianUniqueComponentCount: median(qualities.map((quality) => quality!.uniqueComponentCount)),
    medianPrimitiveRatio: median(qualities.map((quality) => quality!.primitiveRatio)),
    mediaRequestRate: rows.filter((row) => ((row.result.openuiDiagnostics as { assetManifest?: { requests: unknown[] } } | undefined)?.assetManifest?.requests.length ?? 0) > 0).length / rows.length,
    mediaRenderRate: rows.filter((row) => (row.result.openuiDiagnostics?.quality?.mediaComponentCount ?? 0) > 0).length / rows.length,
    repairRate: rows.filter((row) => row.result.openuiDiagnostics?.repairTriggered).length / rows.length,
    medianStep6PromptTokens: median(rows.map((row) => row.result.usage?.prompt ?? 0)),
    medianStep6CompletionTokens: median(rows.map((row) => row.result.usage?.completion ?? 0)),
    medianTotalLatency: median(rows.map((row) => row.result.timing.totalMs)),
  };
  await writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString(), aggregate, rows }, null, 2), "utf8");
  console.log(JSON.stringify(aggregate, null, 2));
}

void main();
