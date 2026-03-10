import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const PROJECT_ID = 'angular-stacker-471711-k4';
const SECRET_NAME = 'granola-refresh-token';
const WORKOS_CLIENT_ID = 'client_01JZJ0XBDAT8PHJWQY09Y0VD61';
const WORKOS_AUTH_URL = 'https://api.workos.com/user_management/authenticate';

const secretClient = new SecretManagerServiceClient();
const secretPath = `projects/${PROJECT_ID}/secrets/${SECRET_NAME}`;

let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Read the current refresh token from Secret Manager (latest version).
 */
async function readRefreshToken() {
  const [version] = await secretClient.accessSecretVersion({
    name: `${secretPath}/versions/latest`,
  });
  return version.payload.data.toString('utf8').trim();
}

/**
 * Write a new refresh token to Secret Manager (adds a new version).
 */
async function writeRefreshToken(newToken) {
  await secretClient.addSecretVersion({
    parent: secretPath,
    payload: { data: Buffer.from(newToken, 'utf8') },
  });
}

/**
 * Exchange a refresh token for a new access token + new refresh token.
 * WorkOS uses single-use rotation — the old refresh token is invalidated.
 */
async function exchangeRefreshToken(refreshToken) {
  const res = await fetch(WORKOS_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: WORKOS_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WorkOS token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
  };
}

/**
 * Get a valid access token, refreshing if needed.
 * Handles the full rotation: read refresh token → exchange → save new refresh token.
 */
export async function getAccessToken() {
  const now = Date.now();

  // Return cached token if still valid (with 5-min buffer)
  if (cachedAccessToken && now < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedAccessToken;
  }

  console.log('[auth] Refreshing access token via WorkOS...');

  const currentRefresh = await readRefreshToken();
  const result = await exchangeRefreshToken(currentRefresh);

  // Persist the new refresh token immediately (single-use rotation)
  await writeRefreshToken(result.refreshToken);
  console.log('[auth] New refresh token saved to Secret Manager');

  cachedAccessToken = result.accessToken;
  tokenExpiresAt = now + result.expiresIn * 1000;

  return cachedAccessToken;
}
