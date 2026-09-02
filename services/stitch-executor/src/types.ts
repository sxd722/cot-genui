export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "expired";
export type JobPhase = "queued" | "generating" | "fetching-html" | "finalizing" | "complete";

export interface StitchArtifact {
  provider: "stitch";
  projectId: string;
  screenId: string;
  model: string;
  htmlSource: string;
  htmlBytes: number;
  durationMs: number;
}

export interface JobRecord {
  id: string;
  requestHash: string;
  prompt: string;
  readTokenHash: string;
  status: JobStatus;
  phase: JobPhase;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  startedAt?: string;
  completedAt?: string;
  canceledAt?: string;
  model: string;
  projectId?: string;
  screenId?: string;
  artifactPath?: string;
  htmlBytes?: number;
  durationMs?: number;
  attempts: number;
  error?: { code: string; message: string };
}

export interface PublicJob {
  jobId: string;
  status: JobStatus;
  phase: JobPhase;
  createdAt: string;
  updatedAt: string;
  elapsedMs: number;
  pollAfterMs: number;
  artifact?: StitchArtifact;
  error?: { code: string; message: string };
}

export interface JobStore {
  get(id: string): Promise<JobRecord | undefined>;
  create(record: JobRecord): Promise<{ record: JobRecord; created: boolean }>;
  patch(id: string, changes: Partial<JobRecord>): Promise<JobRecord>;
}

export interface ArtifactStore {
  put(jobId: string, html: string): Promise<string>;
  get(path: string): Promise<string>;
}

export interface TaskQueue {
  enqueue(jobId: string): Promise<void>;
}

export interface StitchGenerator {
  generate(prompt: string, model: string, onPhase?: (phase: JobPhase) => Promise<void>): Promise<{ projectId: string; screenId: string; html: string; htmlBytes: number }>;
}
