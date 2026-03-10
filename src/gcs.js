import { Storage } from '@google-cloud/storage';

const PROJECT_ID = 'angular-stacker-471711-k4';
const BUCKET_NAME = process.env.GCS_BUCKET || 'unknown-brain-transcripts';

const storage = new Storage({ projectId: PROJECT_ID });
const bucket = storage.bucket(BUCKET_NAME);

/**
 * Sanitize filename to match brain-uploader convention:
 * - Strip path components
 * - Replace non-alphanumeric/dash/underscore/dot with underscore
 * - Limit to 100 chars
 */
function sanitizeFilename(filename) {
  if (!filename) return 'untitled.txt';

  // Strip path components
  const basename = filename.split('/').pop().split('\\').pop();

  // Replace problematic characters with underscores
  let safe = basename.replace(/[^\w\-_.]/g, '_');

  // Limit length
  if (safe.length > 100) {
    const dotIdx = safe.lastIndexOf('.');
    if (dotIdx > 0) {
      const ext = safe.slice(dotIdx);
      safe = safe.slice(0, 95) + ext;
    } else {
      safe = safe.slice(0, 100);
    }
  }

  return safe || 'untitled.txt';
}

/**
 * Build filename matching the Zapier convention:
 * "[Creator] [Title] - [EventTime].txt"
 * After sanitization: "{Creator}_{Title}_-_{EventTime}.txt"
 */
function buildFilename(doc) {
  const creator = doc.people?.creator?.name || 'Unknown';
  const title = doc.title || 'Untitled';
  const eventTime = doc.created_at || new Date().toISOString();

  const raw = `${creator} ${title} - ${eventTime}.txt`;
  return sanitizeFilename(raw);
}

/**
 * Upload a transcript file to GCS, matching the exact format the Eventarc pipeline expects.
 * Files go to transcripts/ prefix as .txt files, matching brain-uploader output.
 *
 * @param {object} doc - Granola document object
 * @param {string} content - The transcript/notes content as plain text
 */
export async function uploadMeeting(doc, content) {
  const filename = buildFilename(doc);
  const gcsKey = `transcripts/${filename}`;
  const file = bucket.file(gcsKey);

  await file.save(content, {
    contentType: 'text/plain',
    metadata: {
      metadata: {
        documentId: doc.id,
        source: 'brain-ingester',
        title: doc.title || '',
        createdAt: doc.created_at || new Date().toISOString(),
      },
    },
  });

  console.log(`[gcs] Uploaded gs://${BUCKET_NAME}/${gcsKey}`);
  return `gs://${BUCKET_NAME}/${gcsKey}`;
}
