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
 * Returns array of folder objects.
 */
export async function fetchFolders() {
  const data = await granolaPost('https://api.granola.ai/v1/get-document-lists-metadata', {});
  const lists = data.lists || {};
  const folders = Object.values(lists);
  console.log(`[granola] Fetched metadata for ${folders.length} folders`);
  return folders;
}

/**
 * Fetch a single folder's details including document list.
 * Uses get-document-list (singular) with list_id param.
 * Returns the full folder object with a documents array.
 */
export async function fetchFolderDetail(listId) {
  const data = await granolaPost('https://api.granola.ai/v1/get-document-list', {
    list_id: listId,
  });
  const docCount = (data.documents || []).length;
  console.log(`[granola] Folder "${data.title}" contains ${docCount} documents`);
  return data;
}

/**
 * Fetch all documents from a specific folder (by name or ID).
 * 1. Resolve folder name → ID via get-document-lists-metadata
 * 2. Get document IDs via get-document-list (singular)
 * 3. Fetch full docs via get-documents-batch (works for shared docs)
 */
export async function fetchFolderDocuments(folderNameOrId) {
  let folderId = folderNameOrId;

  // If it doesn't look like a UUID, look it up by name
  if (!folderNameOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    const folders = await fetchFolders();
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

  // Get folder detail with document list
  const folderDetail = await fetchFolderDetail(folderId);
  const documents = folderDetail.documents || [];

  if (documents.length === 0) {
    console.log(`[granola] Folder has no documents`);
    return [];
  }

  // Extract document IDs
  const docIds = documents
    .map(d => typeof d === 'string' ? d : d.id)
    .filter(Boolean);

  console.log(`[granola] Fetching ${docIds.length} documents via batch...`);

  // Fetch full documents via batch endpoint (works for shared docs)
  return fetchDocumentsBatch(docIds);
}

/**
 * Fetch documents by IDs using the batch endpoint.
 * This works for both owned AND shared documents.
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
