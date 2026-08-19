import { readFile, writeFile } from "node:fs/promises";
import { GENERATION_EVAL_FIXTURES, type GenerationEvalFixture } from "../src/openui/evalFixtures";
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
  const response = await fetch(`${baseUrl}/api/infer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(180_000) });
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
  const resumePath = argument("--resume");
  const requestedIds = new Set((argument("--ids", "") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const rerunIds = new Set((argument("--rerun-ids", "") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const fixtures = requestedIds.size ? GENERATION_EVAL_FIXTURES.filter((fixture) => requestedIds.has(fixture.id)) : GENERATION_EVAL_FIXTURES;
  const rows: Array<{ fixture: GenerationEvalFixture; result?: PipelineStepOutput; error?: string }> = [];
  const resumedReport = resumePath
    ? JSON.parse(await readFile(resumePath, "utf8")) as {
        aggregate?: { modelProfile?: string };
        rows?: Array<{ fixture: GenerationEvalFixture; result?: PipelineStepOutput }>;
      }
    : undefined;
  if (resumedReport?.aggregate?.modelProfile && resumedReport.aggregate.modelProfile !== modelProfile) {
    throw new Error(`Cannot resume ${resumedReport.aggregate.modelProfile} results with ${modelProfile}`);
  }
  const resumedRows = resumedReport?.rows ?? [];
  const reusableResults = new Map(resumedRows.filter((row) => row.result).map((row) => [row.fixture.id, row.result!]));
  for (const [index, fixture] of fixtures.entries()) {
    process.stdout.write(`[${index + 1}/${fixtures.length}] ${fixture.id} ... `);
    const reusable = rerunIds.has(fixture.id) ? undefined : reusableResults.get(fixture.id);
    if (reusable) {
      rows.push({ fixture, result: reusable });
      process.stdout.write("reused\n");
      continue;
    }
    try {
      const result = await evaluateFixture(baseUrl, modelProfile, fixture.query);
      rows.push({ fixture, result });
      process.stdout.write("ok\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({ fixture, error: message });
      process.stdout.write(`failed: ${message}\n`);
    }
  }
  const successfulRows = rows.filter((row): row is { fixture: GenerationEvalFixture; result: PipelineStepOutput } => !!row.result);
  const qualities = successfulRows.map((row) => row.result.openuiDiagnostics?.quality).filter(Boolean);
  const counts = qualities.map((quality) => quality!.cardCount);
  const histogram = Object.fromEntries([...new Set(counts)].sort().map((count) => [count, counts.filter((item) => item === count).length]));
  const simpleRows = successfulRows.filter((row) => row.fixture.expectedTopology.maxCards === 1);
  const aggregate = {
    modelProfile,
    fixtureCount: rows.length,
    completedFixtureCount: successfulRows.length,
    failedFixtureCount: rows.length - successfulRows.length,
    cardCountHistogram: histogram,
    cardCountProtocolValidityRate: qualities.filter((quality) => quality!.cardCount >= 1 && quality!.cardCount <= 6).length / Math.max(1, qualities.length),
    threeCardRate: counts.filter((count) => count === 3).length / Math.max(1, counts.length),
    singleGoalOneCardRate: simpleRows.filter((row) => row.result.openuiDiagnostics?.quality?.cardCount === 1).length / Math.max(1, simpleRows.length),
    expectedTopologyValidityRate: successfulRows.filter((row) => {
      const count = row.result.openuiDiagnostics?.quality?.cardCount ?? 0;
      return count >= row.fixture.expectedTopology.minCards && count <= row.fixture.expectedTopology.maxCards;
    }).length / Math.max(1, successfulRows.length),
    medianUniqueComponentCount: median(qualities.map((quality) => quality!.uniqueComponentCount)),
    medianPrimitiveRatio: median(qualities.map((quality) => quality!.primitiveRatio)),
    semanticComponentUsageRate: qualities.filter((quality) => quality!.semanticStatementCount > 0).length / Math.max(1, qualities.length),
    mediaRequestRate: successfulRows.filter((row) => ((row.result.openuiDiagnostics as { assetManifest?: { requests: unknown[] } } | undefined)?.assetManifest?.requests.length ?? 0) > 0).length / Math.max(1, successfulRows.length),
    mediaCapableRequestRate: successfulRows.filter((row) => row.fixture.expectsMedia && ((row.result.openuiDiagnostics as { assetManifest?: { requests: unknown[] } } | undefined)?.assetManifest?.requests.length ?? 0) > 0).length
      / Math.max(1, successfulRows.filter((row) => row.fixture.expectsMedia).length),
    mediaRenderRate: successfulRows.filter((row) => (row.result.openuiDiagnostics?.quality?.mediaComponentCount ?? 0) > 0).length / Math.max(1, successfulRows.length),
    repairRate: successfulRows.filter((row) => row.result.openuiDiagnostics?.repairTriggered).length / Math.max(1, successfulRows.length),
    invalidAfterRepairRate: rows.filter((row) => /两次|after repair|repair.*invalid/i.test(row.error ?? "")).length / Math.max(1, rows.length),
    promptProfiles: [...new Set(successfulRows.map((row) => row.result.openuiDiagnostics?.promptProfile).filter(Boolean))],
    medianStep6PromptTokens: median(successfulRows.map((row) => row.result.usage?.prompt ?? 0)),
    medianStep6CompletionTokens: median(successfulRows.map((row) => row.result.usage?.completion ?? 0)),
    medianTimeToValidUiMs: median(successfulRows.map((row) => row.result.timing.totalMs)),
  };
  await writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString(), aggregate, rows }, null, 2), "utf8");
  console.log(JSON.stringify(aggregate, null, 2));
}

void main();
