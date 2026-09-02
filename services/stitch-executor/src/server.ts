import { createApp } from "./app.js";
import { CloudTaskQueue, FirestoreJobStore, GcsArtifactStore } from "./adapters.js";
import { GoogleStitchGenerator } from "./stitch.js";

const executorSecret = process.env.STITCH_EXECUTOR_SECRET;
const readTokenSecret = process.env.STITCH_READ_TOKEN_SECRET;
if (!executorSecret || !readTokenSecret || !process.env.STITCH_API_KEY) throw new Error("Required Stitch executor secrets are missing");

const app = createApp({
  jobs: new FirestoreJobStore(), artifacts: new GcsArtifactStore(), queue: new CloudTaskQueue(),
  generator: new GoogleStitchGenerator(), executorSecret, readTokenSecret,
});
app.listen(Number(process.env.PORT || 8080), () => console.log("Stitch executor listening"));
