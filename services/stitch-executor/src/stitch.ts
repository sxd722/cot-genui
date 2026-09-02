import { Stitch, StitchToolClient } from "@google/stitch-sdk";
import { Firestore } from "@google-cloud/firestore";
import type { Project } from "@google/stitch-sdk";
import type { JobPhase, StitchGenerator } from "./types.js";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
let projectIdPromise: Promise<string> | undefined;

async function resolveProject(sdk: Stitch): Promise<Project> {
  const configured = process.env.STITCH_PROJECT_ID?.trim();
  if (configured) return sdk.project(configured);
  projectIdPromise ??= (async () => {
    const ref = new Firestore({ databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)" }).collection("stitchRuntime").doc("project");
    const stored = await ref.get();
    const projectId = stored.data()?.projectId;
    if (typeof projectId === "string" && projectId) return projectId;
    const created = await sdk.createProject("cot-genui-async");
    await ref.set({ projectId: created.id, createdAt: new Date().toISOString() });
    return created.id;
  })().catch((error) => { projectIdPromise = undefined; throw error; });
  return sdk.project(await projectIdPromise);
}

function trusted(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !["google.com", "googleusercontent.com", "googleapis.com", "gstatic.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error("Stitch returned an untrusted HTML URL");
  }
  return url;
}

async function fetchHtml(url: string) {
  let current = trusted(url);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("Stitch HTML redirect limit exceeded");
      current = trusted(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Stitch HTML download failed with HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error("Stitch HTML exceeds 2 MiB");
    const html = buffer.toString("utf8");
    if (!/<html(?:\s|>)/i.test(html) || html.includes("\0")) throw new Error("Stitch returned invalid HTML");
    return { html, htmlBytes: buffer.byteLength };
  }
  throw new Error("Stitch HTML redirect limit exceeded");
}

export class GoogleStitchGenerator implements StitchGenerator {
  async generate(prompt: string, model: string, onPhase?: (phase: JobPhase) => Promise<void>) {
    const client = new StitchToolClient();
    try {
      const sdk = new Stitch(client);
      const project = await resolveProject(sdk);
      const screen = await project.generate(prompt, "DESKTOP", model as "GEMINI_3_FLASH");
      await onPhase?.("fetching-html");
      const htmlUrl = await screen.getHtml();
      const { html, htmlBytes } = await fetchHtml(htmlUrl);
      return { projectId: project.id, screenId: screen.id, html, htmlBytes };
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
