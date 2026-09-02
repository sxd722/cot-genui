export const STEP6_BACKENDS = ["openui", "stitch"] as const;
export type Step6Backend = (typeof STEP6_BACKENDS)[number];

export interface StitchArtifact {
  provider: "stitch";
  projectId: string;
  screenId: string;
  model: string;
  htmlSource: string;
  htmlBytes: number;
  imageUrl: string;
  durationMs: number;
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
    && typeof artifact.imageUrl === "string"
    && typeof artifact.durationMs === "number";
}
