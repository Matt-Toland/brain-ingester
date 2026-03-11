import express from 'express';
import { getAccessToken } from './auth.js';
import { fetchDocuments, fetchFolderDocuments, fetchFolders, fetchTranscript } from './granola.js';
import { buildMeetingMarkdown } from './converter.js';
import { getExistingMeetingIds } from './bigquery.js';
import { uploadMeeting } from './gcs.js';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT, 10) || 8080;

// The shared folder name that contains team meetings
const TARGET_FOLDER = process.env.GRANOLA_FOLDER || 'UNKNOWN BRAIN Meeting Notes';

/**
 * Health check
 */
app.get('/', (_req, res) => {
  res.json({ service: 'brain-ingester', status: 'ok' });
});

/**
 * List all folders in Granola.
 * GET /folders
 */
app.get('/folders', async (_req, res) => {
  try {
    await getAccessToken();
    const folders = await fetchFolders();
    res.json({
      total: folders.length,
      folders: folders.map(f => ({
        id: f.id,
        name: f.name || f.title || 'Untitled',
        memberCount: (f.members || []).length,
        visibility: f.visibility || 'unknown',
        workspace: f.workspace_display_name || null,
      })),
    });
  } catch (err) {
    console.error(`[folders] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * List meetings from the target folder (shared docs).
 * Shows which ones are already processed vs new.
 *
 * GET /meetings                    — from shared folder
 * GET /meetings?source=owned       — your own docs only
 * GET /meetings?folder=CustomName  — specific folder
 * GET /meetings?status=new         — only unprocessed
 * GET /meetings?search=ollie       — filter by title
 */
app.get('/meetings', async (req, res) => {
  try {
    await getAccessToken();

    const { source, folder, status, search } = req.query;

    let documents;
    if (source === 'owned') {
      documents = await fetchDocuments();
    } else {
      const targetFolder = folder || TARGET_FOLDER;
      documents = await fetchFolderDocuments(targetFolder);
    }

    const existingIds = await getExistingMeetingIds();

    let meetings = documents.map(doc => ({
      id: doc.id,
      title: doc.title || 'Untitled',
      creator: doc.people?.creator?.name || 'Unknown',
      date: doc.created_at,
      status: existingIds.has(doc.id) ? 'existing' : 'new',
    }));

    if (status === 'new') meetings = meetings.filter(m => m.status === 'new');
    if (status === 'existing') meetings = meetings.filter(m => m.status === 'existing');

    if (search) {
      const term = search.toLowerCase();
      meetings = meetings.filter(m => m.title.toLowerCase().includes(term));
    }

    res.json({ total: meetings.length, meetings });
  } catch (err) {
    console.error(`[meetings] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Process specific meetings by ID.
 * Skips BigQuery dedup — forces re-processing.
 *
 * POST /ingest/select
 * Body: { "ids": ["doc-id-1", "doc-id-2"] }
 */
app.post('/ingest/select', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Provide { "ids": ["doc-id-1", ...] }' });
  }

  const startTime = Date.now();
  const results = { requested: ids.length, processed: 0, notFound: [], errors: [] };

  try {
    await getAccessToken();

    // Fetch from both owned + folder to find the docs
    const [ownedDocs, folderDocs] = await Promise.all([
      fetchDocuments().catch(() => []),
      fetchFolderDocuments(TARGET_FOLDER).catch(() => []),
    ]);

    const allDocs = [...ownedDocs, ...folderDocs];
    const docMap = new Map(allDocs.map(d => [d.id, d]));

    for (const docId of ids) {
      const doc = docMap.get(docId);
      if (!doc) {
        results.notFound.push(docId);
        continue;
      }

      try {
        let transcript = null;
        try {
          transcript = await fetchTranscript(docId);
        } catch (err) {
          console.warn(`[ingest/select] Could not fetch transcript for ${docId}: ${err.message}`);
        }

        const markdown = buildMeetingMarkdown(doc, transcript);
        await uploadMeeting(doc, markdown);

        results.processed++;
        console.log(`[ingest/select] ✓ ${docId} — ${doc.title || 'Untitled'}`);
      } catch (err) {
        console.error(`[ingest/select] ✗ ${docId}: ${err.message}`);
        results.errors.push({ documentId: docId, error: err.message });
      }
    }

    results.durationMs = Date.now() - startTime;
    res.json(results);
  } catch (err) {
    console.error(`[ingest/select] Fatal error: ${err.message}`);
    res.status(500).json({ error: err.message, ...results, durationMs: Date.now() - startTime });
  }
});

/**
 * Dry run — show what would be processed without uploading.
 *
 * POST /ingest/dry-run
 */
app.post('/ingest/dry-run', async (_req, res) => {
  try {
    await getAccessToken();
    const documents = await fetchFolderDocuments(TARGET_FOLDER);
    const existingIds = await getExistingMeetingIds();

    const newDocs = documents.filter(doc => doc.id && !existingIds.has(doc.id));

    res.json({
      folder: TARGET_FOLDER,
      total: documents.length,
      existing: existingIds.size,
      wouldProcess: newDocs.length,
      meetings: newDocs.map(doc => ({
        id: doc.id,
        title: doc.title || 'Untitled',
        creator: doc.people?.creator?.name || 'Unknown',
        date: doc.created_at,
      })),
    });
  } catch (err) {
    console.error(`[dry-run] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Main ingestion endpoint.
 * Fetches new meetings from the shared folder, converts to markdown, uploads to GCS.
 * Triggered by Cloud Scheduler or called manually.
 */
app.post('/ingest', async (_req, res) => {
  const startTime = Date.now();
  const results = { processed: 0, skipped: 0, errors: [], total: 0, folder: TARGET_FOLDER };

  try {
    await getAccessToken();

    // Fetch from the shared folder (not just owned docs)
    const documents = await fetchFolderDocuments(TARGET_FOLDER);
    results.total = documents.length;

    const existingIds = await getExistingMeetingIds();

    const newDocs = documents.filter(doc => {
      const id = doc.id || doc.document_id;
      return id && !existingIds.has(id);
    });

    console.log(`[ingest] ${newDocs.length} new documents in "${TARGET_FOLDER}" (${existingIds.size} already exist)`);

    for (const doc of newDocs) {
      const docId = doc.id || doc.document_id;
      try {
        let transcript = null;
        try {
          transcript = await fetchTranscript(docId);
        } catch (err) {
          console.warn(`[ingest] Could not fetch transcript for ${docId}: ${err.message}`);
        }

        const markdown = buildMeetingMarkdown(doc, transcript);
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
    res.status(500).json({ error: err.message, ...results, durationMs: Date.now() - startTime });
  }
});

app.listen(PORT, () => {
  console.log(`brain-ingester listening on port ${PORT}`);
});
