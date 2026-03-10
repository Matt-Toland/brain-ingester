import { getAccessToken } from './auth.js';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Granola/5.354.0',
  'X-Client-Version': '5.354.0',
  'Accept-Encoding': 'gzip',
};

/**
 * Make an authenticated POST request to the Granola API.
 */
async function granolaPost(url, body) {
  const token = await getAccessToken();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Granola API ${url} failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Fetch all documents (paginated). Returns flat array.
 */
export async function fetchDocuments() {
  const allDocs = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await granolaPost('https://api.granola.ai/v2/get-documents', {
      limit,
      offset,
      include_last_viewed_panel: true,
    });

    const docs = data.docs || data.documents || data;
    if (!Array.isArray(docs) || docs.length === 0) break;

    allDocs.push(...docs);

    // If we got fewer than limit, we've reached the end
    if (docs.length < limit) break;
    offset += limit;
  }

  console.log(`[granola] Fetched ${allDocs.length} documents`);
  return allDocs;
}

/**
 * Fetch transcript for a single document.
 */
export async function fetchTranscript(documentId) {
  return granolaPost('https://api.granola.ai/v1/get-document-transcript', {
    document_id: documentId,
  });
}
