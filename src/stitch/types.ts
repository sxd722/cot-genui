export const STEP6_BACKENDS = ["openui", "stitch"] as const;
export type Step6Backend = (typeof STEP6_BACKENDS)[number];

export interface StitchArtifact {
  provider: "stitch";
  projectId: string;
  screenId: string;
  model: string;
  htmlSource: string;
  htmlBytes: number;
  imageUrl?: string;
  durationMs: number;
}

export type StitchJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "expired";
export type StitchJobPhase = "queued" | "generating" | "fetching-html" | "finalizing" | "complete";

export interface StitchJobAccepted {
  jobId: string;
  readToken: string;
  status: "queued";
  pollAfterMs: number;
}

export interface StitchJobProgress {
  jobId: string;
  status: StitchJobStatus;
  phase: StitchJobPhase;
  createdAt: string;
  updatedAt: string;
  elapsedMs: number;
  pollAfterMs: number;
  artifact?: StitchArtifact;
  error?: { code: string; message: string };
}

export interface ActiveStitchJobRecord {
  jobId: string;
  readToken: string;
  query: string;
  cardPlan: unknown;
  createdAt: string;
  updatedAt: string;
}

export function isStitchArtifact(value: unknown): value is StitchArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<StitchArtifact>;
  return artifact.provider === "stitch"
    && typeof artifact.projectId === "string"
    && typeof artifact.screenId === "string"
    && typeof artifact.model === "string"
    && typeof artifact.htmlSource === "string"
    && typeof artifact.htmlBytes === "number"
    && (artifact.imageUrl === undefined || typeof artifact.imageUrl === "string")
    && typeof artifact.durationMs === "number";
}
