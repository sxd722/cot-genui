import { describe, expect, it } from "vitest";
import type { StepTiming } from "../../src/lib/pipelineTypes";
import { hasCompleteOpenUIStatement } from "../../src/openui/streamTiming";

describe("OpenUI timing contract", () => {
  it("can expose first content and first statement timing", () => {
    const timing: StepTiming = {
      totalMs: 1200,
      llmMs: 1000,
      overheadMs: 200,
      timeToFirstContentMs: 180,
      timeToFirstModelStatementMs: 260,
    };

    expect(timing.timeToFirstContentMs).toBeLessThan(timing.llmMs);
    expect(timing.timeToFirstModelStatementMs).toBeGreaterThanOrEqual(timing.timeToFirstContentMs!);
  });

  it("waits for a top-level newline before declaring a streamed statement complete", () => {
    expect(hasCompleteOpenUIStatement('root = Stack([card], "column")')).toBe(false);
    expect(hasCompleteOpenUIStatement('root = Stack([card],\n  "column")\n')).toBe(true);
    expect(hasCompleteOpenUIStatement('title = TextContent("line one\nline two")\n')).toBe(true);
  });

  it("can accept a complete trailing statement when the stream ends without a newline", () => {
    expect(hasCompleteOpenUIStatement("root = Stack([card])", true)).toBe(true);
    expect(hasCompleteOpenUIStatement("root = Stack([card]", true)).toBe(false);
  });
});
