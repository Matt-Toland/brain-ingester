import express from 'express';
import { getAccessToken } from './auth.js';
import { fetchDocuments, fetchTranscript } from './granola.js';
import { buildMeetingMarkdown } from './converter.js';
import { getExistingMeetingIds } from './bigquery.js';
import { uploadMeeting } from './gcs.js';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT, 10) || 8080;

/**
 * Health check
 */
app.get('/', (_req, res) => {
  res.json({ service: 'brain-ingester', status: 'ok' });
});

/**
 * Main ingestion endpoint.
 * Fetches new Granola documents, converts to markdown, uploads to GCS.
 * Designed to be triggered by Cloud Scheduler or called manually.
 */
app.post('/ingest', async (_req, res) => {
  const startTime = Date.now();
  const results = { processed: 0, skipped: 0, errors: [], total: 0 };

  try {
    // 1. Ensure we have a valid token (also rotates refresh token)
    await getAccessToken();

    // 2. Fetch all documents from Granola
    const documents = await fetchDocuments();
    results.total = documents.length;

    // 3. Get already-processed meeting IDs from BigQuery
    const existingIds = await getExistingMeetingIds();

    // 4. Filter to new documents only
    const newDocs = documents.filter(doc => {
      const id = doc.id || doc.document_id;
      return id && !existingIds.has(id);
    });

    console.log(`[ingest] ${newDocs.length} new documents to process (${existingIds.size} already exist)`);

    // 5. Process each new document
    for (const doc of newDocs) {
      const docId = doc.id || doc.document_id;
      try {
        // Fetch transcript
        let transcript = null;
        try {
          transcript = await fetchTranscript(docId);
        } catch (err) {
          console.warn(`[ingest] Could not fetch transcript for ${docId}: ${err.message}`);
        }

        // Convert to markdown
        const markdown = buildMeetingMarkdown(doc, transcript);

        // Upload to GCS (pass full doc for filename generation)
        await uploadMeeting(doc, markdown);

        results.processed++;
        console.log(`[ingest] ✓ ${docId} — ${doc.title || 'Untitled'}`);
      } catch (err) {
        console.error(`[ingest] ✗ ${docId}: ${err.message}`);
        results.errors.push({ documentId: docId, error: err.message });
      }
    }

    results.skipped = results.total - newDocs.length;
    results.durationMs = Date.now() - startTime;

    console.log(`[ingest] Done: ${results.processed} processed, ${results.skipped} skipped, ${results.errors.length} errors in ${results.durationMs}ms`);

    res.json(results);
  } catch (err) {
    console.error(`[ingest] Fatal error: ${err.message}`);
    res.status(500).json({
      error: err.message,
      ...results,
      durationMs: Date.now() - startTime,
    });
  }
});

app.listen(PORT, () => {
  console.log(`brain-ingester listening on port ${PORT}`);
});
