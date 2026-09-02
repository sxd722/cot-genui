import { StitchError } from "@google/stitch-sdk";
import { NextResponse } from "next/server";
import { isStitchConfigured, withStitchProject } from "@/stitch/server";
import { buildStitchPrompt } from "@/stitch/prompt";
import { fetchStitchHtmlSource, isTrustedStitchUrl } from "@/stitch/html";
import type { StitchArtifact } from "@/stitch/types";
import { parseStitchCardPlan } from "@/stitch/cardPlan";

export const runtime = "nodejs";

type StitchModel = "GEMINI_3_FLASH" | "GEMINI_3_PRO" | "GEMINI_3_1_PRO";

function getModel(): StitchModel {
  const configured = process.env.STITCH_MODEL_ID;
  if (configured === "GEMINI_3_PRO" || configured === "GEMINI_3_1_PRO") {
    return configured;
  }
  return "GEMINI_3_FLASH";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { parseStitchCardPlan } from "@/stitch/cardPlan";

/**
 * POST /api/stitch/generate
 * Body: { cardPlan }
 *
 * Standalone Stitch MVP endpoint — deliberately not part of /api/infer.
 * The whole CardPlan goes through one project.generate() call; the visual
 * design is entirely decided by Stitch + Gemini.
 */
export async function POST(request: Request) {
  try {
    if (!isStitchConfigured()) {
      return NextResponse.json(
        { code: "stitch_unconfigured", error: "Stitch 尚未配置，请在服务端设置 STITCH_API_KEY。" },
        { status: 503 },
      );
    }

    const body: unknown = await request.json();
    const cardPlan = isRecord(body) ? parseStitchCardPlan(body.cardPlan) : null;
    const query = isRecord(body) && typeof body.query === "string" ? body.query.slice(0, 8_000) : undefined;
    if (!cardPlan) {
      return NextResponse.json({ error: "Missing CardPlan" }, { status: 400 });
    }

    const startedAt = Date.now();
    const prompt = buildStitchPrompt(cardPlan, query);
    const model = getModel();

    const generated = await withStitchProject(async (project) => {
      const screen = await project.generate(prompt, "DESKTOP", model);
      const [htmlUrl, imageUrl] = await Promise.all([screen.getHtml(), screen.getImage()]);
      return { projectId: project.id, screenId: screen.id, htmlUrl, imageUrl };
    });
    const { projectId, screenId, htmlUrl, imageUrl } = generated;
    if (!isTrustedStitchUrl(htmlUrl)) {
      throw new Error("Stitch returned an invalid HTML download URL");
    }
    const trustedImageUrl = isTrustedStitchUrl(imageUrl) ? imageUrl : "";
    if (!trustedImageUrl) {
      // A freshly generated screen can expose HTML before its asynchronous
      // screenshot is ready. HTML is the primary artifact, so keep the run
      // usable and hide the optional screenshot fallback.
      console.warn("[stitch:generate] screenshot unavailable", {
        screenId,
        imageUrlPresent: Boolean(imageUrl),
      });
    }
    const html = await fetchStitchHtmlSource(htmlUrl);

    const artifact: StitchArtifact = {
      provider: "stitch",
      projectId,
      screenId,
      model,
      htmlSource: html.source,
      htmlBytes: html.bytes,
      imageUrl: trustedImageUrl,
      durationMs: Date.now() - startedAt,
    };
    return NextResponse.json(artifact, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const providerCode = error instanceof StitchError ? error.code : "UNKNOWN_ERROR";
    console.error("[stitch:generate]", {
      code: providerCode,
      message: error instanceof Error ? error.message : String(error),
      recoverable: error instanceof StitchError ? error.recoverable : false,
    });
    const status = providerCode === "AUTH_FAILED" || providerCode === "PERMISSION_DENIED"
      ? 401
      : providerCode === "RATE_LIMITED" ? 429 : 502;
    return NextResponse.json(
      {
        code: `stitch_${providerCode.toLowerCase()}`,
        error: error instanceof Error ? error.message : "Stitch generation failed",
      },
      { status },
    );
  }
}
