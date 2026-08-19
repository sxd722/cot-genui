import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NVIDIA_BUILD_BASE_URL, NVIDIA_DIFFUSION_GEMMA_MODEL, nvidiaChatOptions } from "../../src/lib/nvidia";
import { MODEL_PROFILES, MODEL_PROFILE_LABELS } from "../../src/lib/pipelineTypes";

describe("NVIDIA DiffusionGemma provider", () => {
  it("is available as a selectable NVIDIA Build model", () => {
    expect(MODEL_PROFILES).toContain("nvidia_diffusion_gemma_26b");
    expect(MODEL_PROFILE_LABELS.nvidia_diffusion_gemma_26b).toContain("DiffusionGemma");
    expect(NVIDIA_BUILD_BASE_URL).toBe("https://integrate.api.nvidia.com/v1");
    expect(NVIDIA_DIFFUSION_GEMMA_MODEL).toBe("google/diffusiongemma-26b-a4b-it");
  });

  it("uses only the chat-template reasoning switch and never declares tools", () => {
    const options = nvidiaChatOptions(false);

    expect(options).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(options).not.toHaveProperty("tools");
    expect(options).not.toHaveProperty("tool_choice");
  });

  it("routes fresh-data search through another provider before NVIDIA inference", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/pipeline.ts"), "utf8");

    expect(source).toContain('(args.provider === "groq" || args.provider === "nvidia") && args.webSearchQuery');
    expect(source).toContain('args.provider === "nvidia" ? nvidiaChatOptions(args.thinking) : {}');
    expect(source).toContain('args.provider !== "nvidia"');
    expect(source).toContain("providerSearchResults: providerSearch");
  });
});
