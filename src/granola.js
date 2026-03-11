import { getAccessToken } from './auth.js';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Granola/7.57.0',
  'X-Client-Version': '7.57.0',
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
 * Fetch folder metadata using the working get-document-lists-metadata endpoint.
 * Returns a map of folder objects keyed by ID.
 */
export async function fetchFolderMetadata() {
  const data = await granolaPost('https://api.granola.ai/v1/get-document-lists-metadata', {});
  const lists = data.lists || {};
  const folders = Object.values(lists);
  console.log(`[granola] Fetched metadata for ${folders.length} folders`);
  return folders;
}

/**
 * Fetch all documents from a specific folder by passing document_list_id
 * to the v2/get-documents endpoint. This returns shared docs too.
 */
export async function fetchFolderDocuments(folderNameOrId) {
  // First resolve folder name to ID if needed
  let folderId = folderNameOrId;

  // If it doesn't look like a UUID, look it up by name
  if (!folderNameOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    const folders = await fetchFolderMetadata();
    const folder = folders.find(f =>
      (f.name || f.title || '').toLowerCase() === folderNameOrId.toLowerCase()
    );

    if (!folder) {
      const available = folders.map(f => f.name || f.title || f.id).join(', ');
      throw new Error(`Folder "${folderNameOrId}" not found. Available: ${available}`);
    }

    folderId = folder.id;
    console.log(`[granola] Resolved folder "${folderNameOrId}" to ID ${folderId}`);
  }

  // Fetch documents from the folder using v2/get-documents with document_list_id
  const allDocs = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await granolaPost('https://api.granola.ai/v2/get-documents', {
      document_list_id: folderId,
      limit,
      offset,
      include_last_viewed_panel: true,
    });

    const docs = data.docs || data.documents || data;
    if (!Array.isArray(docs) || docs.length === 0) break;

    allDocs.push(...docs);

    if (docs.length < limit) break;
    offset += limit;
  }

  console.log(`[granola] Fetched ${allDocs.length} documents from folder ${folderId}`);
  return allDocs;
}

/**
 * Fetch documents by IDs using the batch endpoint.
 */
export async function fetchDocumentsBatch(documentIds) {
  if (!documentIds || documentIds.length === 0) return [];

  const allDocs = [];
  // Batch in chunks of 100
  for (let i = 0; i < documentIds.length; i += 100) {
    const chunk = documentIds.slice(i, i + 100);
    const data = await granolaPost('https://api.granola.ai/v1/get-documents-batch', {
      document_ids: chunk,
      include_last_viewed_panel: true,
    });
    const docs = data.documents || data.docs || [];
    allDocs.push(...docs);
  }

  console.log(`[granola] Fetched ${allDocs.length} documents via batch`);
  return allDocs;
}

/**
 * Fetch all documents (paginated). Returns flat array.
 * NOTE: Only returns documents OWNED by you, not shared ones.
 * For shared docs, use fetchFolderDocuments() instead.
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

    if (docs.length < limit) break;
    offset += limit;
  }

  console.log(`[granola] Fetched ${allDocs.length} owned documents`);
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

/**
 * Fetch all folder listings (legacy - uses broken get-document-lists).
 * @deprecated Use fetchFolderMetadata() instead.
 */
export async function fetchFolders() {
  return fetchFolderMetadata();
}
