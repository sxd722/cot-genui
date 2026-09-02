import { Firestore, Timestamp } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { CloudTasksClient } from "@google-cloud/tasks";
import type { ArtifactStore, JobRecord, JobStore, TaskQueue } from "./types.js";

export class FirestoreJobStore implements JobStore {
  private readonly collection;
  constructor(databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)") {
    this.collection = new Firestore({ databaseId }).collection(process.env.FIRESTORE_JOBS_COLLECTION || "stitchJobs");
  }
  private normalize(value: FirebaseFirestore.DocumentData | undefined): JobRecord | undefined {
    if (!value) return undefined;
    return { ...value, expiresAt: value.expiresAt instanceof Timestamp ? value.expiresAt.toDate().toISOString() : String(value.expiresAt) } as JobRecord;
  }
  async get(id: string) { return this.normalize((await this.collection.doc(id).get()).data()); }
  async create(record: JobRecord) {
    const ref = this.collection.doc(record.id);
    return ref.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.exists) return { record: this.normalize(current.data()) as JobRecord, created: false };
      transaction.create(ref, { ...record, expiresAt: Timestamp.fromDate(new Date(record.expiresAt)) });
      return { record, created: true };
    });
  }
  async patch(id: string, changes: Partial<JobRecord>) {
    const ref = this.collection.doc(id);
    await ref.set(changes, { merge: true });
    const result = this.normalize((await ref.get()).data());
    if (!result) throw new Error("Job disappeared after update");
    return result;
  }
}

export class GcsArtifactStore implements ArtifactStore {
  private readonly bucket;
  constructor() {
    const bucket = process.env.STITCH_ARTIFACT_BUCKET;
    if (!bucket) throw new Error("STITCH_ARTIFACT_BUCKET is required");
    this.bucket = new Storage().bucket(bucket);
  }
  async put(jobId: string, html: string) {
    const path = `stitch/${jobId}/artifact.html`;
    await this.bucket.file(path).save(html, { contentType: "text/html; charset=utf-8", resumable: false, metadata: { cacheControl: "private, no-store" } });
    return path;
  }
  async get(path: string) { return (await this.bucket.file(path).download())[0].toString("utf8"); }
}

export class CloudTaskQueue implements TaskQueue {
  private readonly client = new CloudTasksClient();
  async enqueue(jobId: string) {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.CLOUD_TASKS_LOCATION || "asia-east1";
    const queue = process.env.CLOUD_TASKS_QUEUE || "stitch-generation";
    const serviceUrl = process.env.STITCH_EXECUTOR_PUBLIC_URL;
    const serviceAccountEmail = process.env.CLOUD_TASKS_SERVICE_ACCOUNT;
    if (!project || !serviceUrl || !serviceAccountEmail) throw new Error("Cloud Tasks configuration is incomplete");
    await this.client.createTask({
      parent: this.client.queuePath(project, location, queue),
      task: {
        httpRequest: {
          httpMethod: "POST",
          url: `${serviceUrl.replace(/\/$/, "")}/internal/jobs/${jobId}/execute`,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from("{}"),
          oidcToken: { serviceAccountEmail, audience: serviceUrl },
        },
        dispatchDeadline: { seconds: 600 },
      },
    });
  }
}

export class MemoryJobStore implements JobStore {
  readonly records = new Map<string, JobRecord>();
  async get(id: string) { return this.records.get(id); }
  async create(record: JobRecord) {
    const current = this.records.get(record.id);
    if (current) return { record: current, created: false };
    this.records.set(record.id, record);
    return { record, created: true };
  }
  async patch(id: string, changes: Partial<JobRecord>) {
    const current = this.records.get(id);
    if (!current) throw new Error("Unknown job");
    const next = { ...current, ...changes };
    this.records.set(id, next);
    return next;
  }
}

export class MemoryArtifactStore implements ArtifactStore {
  readonly records = new Map<string, string>();
  async put(jobId: string, html: string) { const path = `stitch/${jobId}/artifact.html`; this.records.set(path, html); return path; }
  async get(path: string) { const value = this.records.get(path); if (value === undefined) throw new Error("Missing artifact"); return value; }
}

export class MemoryTaskQueue implements TaskQueue {
  readonly jobs: string[] = [];
  async enqueue(jobId: string) { this.jobs.push(jobId); }
}
