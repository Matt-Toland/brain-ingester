# brain-ingester

Cloud Run service that replaces the Zapier pipeline for Unknown Brain. Ingests meeting documents from Granola, converts them to markdown, and uploads to GCS for the existing Eventarc → LLM scoring → BigQuery pipeline.

## How it works

1. **Auth** — Reads a WorkOS refresh token from GCP Secret Manager, exchanges it for an access token (single-use rotation), and saves the new refresh token back.
2. **Fetch** — Pulls all meeting documents from the Granola API.
3. **Dedup** — Checks BigQuery `unknown_brain.meeting_intel` for already-processed meeting IDs.
4. **Convert** — Transforms ProseMirror note content + transcript into markdown.
5. **Upload** — Writes `.md` files to GCS, triggering the existing Eventarc pipeline.

## Endpoints

| Method | Path      | Description                          |
|--------|-----------|--------------------------------------|
| GET    | `/`       | Health check                         |
| POST   | `/ingest` | Run ingestion (idempotent, deduped)  |

## Environment variables

| Variable     | Default                    | Description                    |
|--------------|----------------------------|--------------------------------|
| `PORT`       | `8080`                     | Server port                    |
| `GCS_BUCKET` | `unknown-brain-meetings`   | GCS bucket for markdown files  |

## GCP setup

### Secret Manager
Create the secret (one-time):
```bash
echo -n "YOUR_INITIAL_REFRESH_TOKEN" | \
  gcloud secrets create granola-refresh-token \
    --project=angular-stacker-471711-k4 \
    --data-file=-
```

### IAM permissions
The Cloud Run service account needs:
- `roles/secretmanager.secretAccessor` + `roles/secretmanager.secretVersionAdder` (on `granola-refresh-token`)
- `roles/storage.objectCreator` (on the GCS bucket)
- `roles/bigquery.dataViewer` (on `unknown_brain` dataset)

### Deploy
```bash
gcloud run deploy brain-ingester \
  --project=angular-stacker-471711-k4 \
  --region=europe-west1 \
  --source=. \
  --set-env-vars=GCS_BUCKET=unknown-brain-meetings \
  --no-allow-unauthenticated
```

### Schedule (Cloud Scheduler)
```bash
gcloud scheduler jobs create http brain-ingester-trigger \
  --project=angular-stacker-471711-k4 \
  --location=europe-west1 \
  --schedule="0 */2 * * *" \
  --uri="https://brain-ingester-HASH-ew.a.run.app/ingest" \
  --http-method=POST \
  --oidc-service-account-email=YOUR_SA@angular-stacker-471711-k4.iam.gserviceaccount.com
```

## Local development

```bash
npm install
# Ensure gcloud auth is configured for Secret Manager / BigQuery / GCS access
npm run dev
# Then: curl -X POST http://localhost:8080/ingest
```

## Dependencies

- `express` — HTTP server
- `@google-cloud/secret-manager` — Refresh token storage
- `@google-cloud/storage` — GCS upload
- `@google-cloud/bigquery` — Deduplication check
