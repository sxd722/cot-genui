#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}"
: "${STITCH_API_KEY:?Set STITCH_API_KEY}"
: "${STITCH_EXECUTOR_SECRET:?Set STITCH_EXECUTOR_SECRET}"
: "${STITCH_READ_TOKEN_SECRET:?Set STITCH_READ_TOKEN_SECRET}"

REGION="${GOOGLE_CLOUD_REGION:-asia-east1}"
SERVICE="${STITCH_EXECUTOR_SERVICE:-cot-genui-stitch-executor}"
QUEUE="${CLOUD_TASKS_QUEUE:-stitch-generation}"
BUCKET="${STITCH_ARTIFACT_BUCKET:-${GOOGLE_CLOUD_PROJECT}-cot-genui-stitch}"
TASK_SA="${CLOUD_TASKS_SERVICE_ACCOUNT:-stitch-tasks@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com}"
EXECUTOR_SA="${STITCH_EXECUTOR_SERVICE_ACCOUNT:-stitch-executor@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com}"

gcloud config set project "$GOOGLE_CLOUD_PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com storage.googleapis.com cloudtasks.googleapis.com secretmanager.googleapis.com
gcloud firestore databases create --location="$REGION" --type=firestore-native 2>/dev/null || true
gcloud firestore fields ttls update expiresAt --collection-group=stitchJobs --enable-ttl --quiet 2>/dev/null || true
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access

LIFECYCLE_FILE="$(mktemp)"
trap 'rm -f "$LIFECYCLE_FILE"' EXIT
printf '%s\n' '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}' > "$LIFECYCLE_FILE"
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$LIFECYCLE_FILE"

gcloud iam service-accounts describe "$TASK_SA" >/dev/null 2>&1 || gcloud iam service-accounts create stitch-tasks --display-name="Stitch Cloud Tasks"
gcloud iam service-accounts describe "$EXECUTOR_SA" >/dev/null 2>&1 || gcloud iam service-accounts create stitch-executor --display-name="Stitch Executor"
for ROLE in roles/datastore.user roles/cloudtasks.enqueuer roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" --member="serviceAccount:$EXECUTOR_SA" --role="$ROLE" >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$EXECUTOR_SA" --role="roles/storage.objectAdmin" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$TASK_SA" --member="serviceAccount:$EXECUTOR_SA" --role="roles/iam.serviceAccountUser" >/dev/null
gcloud tasks queues describe "$QUEUE" --location="$REGION" >/dev/null 2>&1 || gcloud tasks queues create "$QUEUE" --location="$REGION" --max-concurrent-dispatches=2 --max-attempts=2
gcloud tasks queues update "$QUEUE" --location="$REGION" --max-concurrent-dispatches=2 --max-attempts=2 >/dev/null

for SECRET_NAME in stitch-api-key stitch-executor-secret stitch-read-token-secret; do
  gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1 || gcloud secrets create "$SECRET_NAME" --replication-policy=automatic
done
printf '%s' "$STITCH_API_KEY" | gcloud secrets versions add stitch-api-key --data-file=- >/dev/null
printf '%s' "$STITCH_EXECUTOR_SECRET" | gcloud secrets versions add stitch-executor-secret --data-file=- >/dev/null
printf '%s' "$STITCH_READ_TOKEN_SECRET" | gcloud secrets versions add stitch-read-token-secret --data-file=- >/dev/null

gcloud run deploy "$SERVICE" --source=. --region="$REGION" --cpu=1 --memory=512Mi --timeout=900 --min=0 --allow-unauthenticated --service-account="$EXECUTOR_SA" \
  --set-env-vars="STITCH_MODEL_ID=${STITCH_MODEL_ID:-GEMINI_3_FLASH},STITCH_PROJECT_ID=${STITCH_PROJECT_ID:-},STITCH_ARTIFACT_BUCKET=$BUCKET,CLOUD_TASKS_LOCATION=$REGION,CLOUD_TASKS_QUEUE=$QUEUE,CLOUD_TASKS_SERVICE_ACCOUNT=$TASK_SA" \
  --set-secrets="STITCH_API_KEY=stitch-api-key:latest,STITCH_EXECUTOR_SECRET=stitch-executor-secret:latest,STITCH_READ_TOKEN_SECRET=stitch-read-token-secret:latest"

SERVICE_URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
gcloud run services update "$SERVICE" --region="$REGION" --set-env-vars="STITCH_EXECUTOR_PUBLIC_URL=$SERVICE_URL"
gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" --member="serviceAccount:$TASK_SA" --role="roles/run.invoker"

echo "STITCH_EXECUTOR_URL=$SERVICE_URL"
echo "Configure the same STITCH_EXECUTOR_SECRET in OpenAI Sites."
