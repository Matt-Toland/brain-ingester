import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = 'angular-stacker-471711-k4';
const DATASET = 'unknown_brain';
const TABLE = 'meeting_intel';

const bq = new BigQuery({ projectId: PROJECT_ID });

/**
 * Fetch the set of Granola document IDs that already exist in BigQuery.
 * Returns a Set<string> for O(1) lookup.
 */
export async function getExistingMeetingIds() {
  const query = `
    SELECT DISTINCT meeting_id
    FROM \`${PROJECT_ID}.${DATASET}.${TABLE}\`
    WHERE meeting_id IS NOT NULL
  `;

  try {
    const [rows] = await bq.query({ query });
    const ids = new Set(rows.map(r => r.meeting_id));
    console.log(`[bigquery] Found ${ids.size} existing meeting IDs`);
    return ids;
  } catch (err) {
    // If table doesn't exist yet, treat as empty
    if (err.code === 404 || err.message?.includes('Not found')) {
      console.warn('[bigquery] Table not found, treating as empty');
      return new Set();
    }
    throw err;
  }
}
