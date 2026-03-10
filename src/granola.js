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
 * Fetch all document lists (folders).
 * Returns array of folder objects with document IDs.
 */
export async function fetchFolders() {
  // Try v2 first, fall back to v1
  try {
    const data = await granolaPost('https://api.granola.ai/v2/get-document-lists', {});
    const folders = Array.isArray(data) ? data : (data.document_lists || data.lists || []);
    console.log(`[granola] Fetched ${folders.length} folders (v2)`);
    return folders;
  } catch (err) {
    console.warn(`[granola] v2 folder fetch failed, trying v1: ${err.message}`);
    const data = await granolaPost('https://api.granola.ai/v1/get-document-lists', {});
    const folders = Array.isArray(data) ? data : (data.document_lists || data.lists || []);
    console.log(`[granola] Fetched ${folders.length} folders (v1)`);
    return folders;
  }
}

/**
 * Fetch documents by IDs using the batch endpoint.
 * This is the only way to get SHARED documents (not owned by you).
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
 * Fetch all documents from a specific folder (by name or ID).
 * Uses get-document-lists to find the folder, then get-documents-batch for the docs.
 */
export async function fetchFolderDocuments(folderNameOrId) {
  const folders = await fetchFolders();

  const folder = folders.find(f =>
    f.id === folderNameOrId ||
    (f.name || f.title || '').toLowerCase() === folderNameOrId.toLowerCase()
  );

  if (!folder) {
    const available = folders.map(f => f.name || f.title || f.id).join(', ');
    throw new Error(`Folder "${folderNameOrId}" not found. Available: ${available}`);
  }

  const folderName = folder.name || folder.title || folder.id;
  console.log(`[granola] Found folder "${folderName}" with ID ${folder.id}`);

  // Get document IDs from the folder
  let docIds = [];
  if (folder.documents && Array.isArray(folder.documents)) {
    docIds = folder.documents.map(d => typeof d === 'string' ? d : d.id).filter(Boolean);
  } else if (folder.document_ids && Array.isArray(folder.document_ids)) {
    docIds = folder.document_ids;
  }

  if (docIds.length === 0) {
    console.log(`[granola] Folder "${folderName}" has no documents`);
    return [];
  }

  console.log(`[granola] Folder "${folderName}" contains ${docIds.length} documents`);

  // Fetch full documents via batch endpoint
  return fetchDocumentsBatch(docIds);
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
