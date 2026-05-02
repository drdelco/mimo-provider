import * as vscode from 'vscode';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// OAuth Device-Code Flow for Kimi (Moonshot) and MiniMax
// ---------------------------------------------------------------------------

export interface OAuthToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;    // Unix timestamp (ms) when token expires
  token_type: string;
  scope: string;
}

interface OAuthProviderConfig {
  id: 'kimi' | 'minimax';
  name: string;
  authHost: string;
  clientId: string;
  audience: string;
  scope: string;
  apiBaseUrl: string;
}

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  kimi: {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    authHost: 'https://auth.kimi.com',
    clientId: '17e5f671-d194-4dfb-9706-5516cb48c098',
    audience: 'https://api.kimi.com',
    scope: 'openid profile email offline_access',
    apiBaseUrl: 'https://api.kimi.com/coding/v1'
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    authHost: 'https://platform.minimax.io',
    clientId: 'openclaw',  // Public client (same as OpenClaw uses)
    audience: 'https://api.minimax.io',
    scope: 'openid profile email offline_access',
    apiBaseUrl: 'https://api.minimax.io/v1'
  }
};

// In-memory token cache (persisted to VS Code secrets)
const tokenCache: Map<string, OAuthToken> = new Map();

let _secretStorage: vscode.SecretStorage | undefined;

export function initOAuth(secretStorage: vscode.SecretStorage): void {
  _secretStorage = secretStorage;
}

function getSecretStorage(): vscode.SecretStorage {
  if (!_secretStorage) {
    throw new Error('OAuth not initialized. Call initOAuth() first.');
  }
  return _secretStorage;
}

// ---------------------------------------------------------------------------
// Token Storage
// ---------------------------------------------------------------------------

function secretKey(providerId: string): string {
  return `mimo.oauth.${providerId}`;
}

export async function getStoredToken(providerId: string): Promise<OAuthToken | null> {
  // Check memory cache first
  const cached = tokenCache.get(providerId);
  if (cached) return cached;

  // Load from secret storage
  const raw = await getSecretStorage().get(secretKey(providerId));
  if (!raw) return null;

  try {
    const token: OAuthToken = JSON.parse(raw);
    tokenCache.set(providerId, token);
    return token;
  } catch {
    return null;
  }
}

async function storeToken(providerId: string, token: OAuthToken): Promise<void> {
  tokenCache.set(providerId, token);
  await getSecretStorage().store(secretKey(providerId), JSON.stringify(token));
}

export async function clearToken(providerId: string): Promise<void> {
  tokenCache.delete(providerId);
  await getSecretStorage().delete(secretKey(providerId));
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

async function refreshToken(providerId: string, refreshToken: string): Promise<OAuthToken | null> {
  const config = OAUTH_PROVIDERS[providerId];
  if (!config) return null;

  try {
    const response = await fetch(`${config.authHost}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId
      }).toString(),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.warn(`MiMo OAuth: Token refresh failed for ${providerId}: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    const token: OAuthToken = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: Date.now() + (data.expires_in * 1000),
      token_type: data.token_type || 'Bearer',
      scope: data.scope || config.scope
    };

    await storeToken(providerId, token);
    return token;
  } catch (err: any) {
    console.warn(`MiMo OAuth: Refresh error for ${providerId}:`, err.message);
    return null;
  }
}

/**
 * Get a valid access token for a provider.
 * Auto-refreshes if expired. Returns null if no token or refresh fails.
 */
export async function getValidToken(providerId: string): Promise<string | null> {
  const token = await getStoredToken(providerId);
  if (!token) return null;

  // Check if token is still valid (with 60s buffer)
  if (token.expires_at > Date.now() + 60_000) {
    return token.access_token;
  }

  // Token expired — try refresh
  if (token.refresh_token) {
    const refreshed = await refreshToken(providerId, token.refresh_token);
    if (refreshed) return refreshed.access_token;
  }

  // Refresh failed — clear stale token
  await clearToken(providerId);
  return null;
}

// ---------------------------------------------------------------------------
// Device Code Flow
// ---------------------------------------------------------------------------

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

async function requestDeviceCode(config: OAuthProviderConfig): Promise<DeviceCodeResponse> {
  const response = await fetch(`${config.authHost}/oauth/device/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      audience: config.audience,
      scope: config.scope
    }).toString(),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Device code request failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

async function pollForToken(
  config: OAuthProviderConfig,
  deviceCode: string,
  interval: number,
  expiresIn: number,
  cancellationToken: vscode.CancellationToken
): Promise<TokenResponse> {
  const startTime = Date.now();
  const expiresAt = startTime + (expiresIn * 1000);
  let pollInterval = Math.max(interval, 5) * 1000; // Minimum 5 seconds

  while (Date.now() < expiresAt) {
    if (cancellationToken.isCancellationRequested) {
      throw new Error('Login cancelled by user');
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));

    try {
      const response = await fetch(`${config.authHost}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: config.clientId
        }).toString(),
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok) {
        return response.json() as Promise<TokenResponse>;
      }

      const data = await response.json().catch(() => ({})) as any;

      if (data.error === 'authorization_pending') {
        continue; // Keep polling
      }

      if (data.error === 'slow_down') {
        pollInterval += 5000; // Server requests slower polling
        continue;
      }

      if (data.error === 'expired_token') {
        throw new Error('Login code expired. Please try again.');
      }

      if (data.error === 'access_denied') {
        throw new Error('Login denied by user.');
      }

      throw new Error(`Token request failed: ${data.error || response.status}`);
    } catch (err: any) {
      if (err.message.includes('expired') || err.message.includes('denied') || err.message.includes('cancelled')) {
        throw err;
      }
      // Network error — retry
      console.warn('MiMo OAuth: Poll error, retrying:', err.message);
    }
  }

  throw new Error('Login code expired. Please try again.');
}

// ---------------------------------------------------------------------------
// Public Login Flow
// ---------------------------------------------------------------------------

/**
 * Start the OAuth device-code login flow for a provider.
 * Opens browser, shows progress, polls for token.
 * Returns the access token on success, or throws on failure.
 */
export async function loginWithOAuth(providerId: 'kimi' | 'minimax'): Promise<string> {
  const config = OAUTH_PROVIDERS[providerId];
  if (!config) {
    throw new Error(`Unknown OAuth provider: ${providerId}`);
  }

  // Step 1: Request device code
  const deviceCode = await requestDeviceCode(config);

  // Step 2: Open browser for user authorization
  const authUrl = deviceCode.verification_uri_complete || deviceCode.verification_uri;
  await vscode.env.openExternal(vscode.Uri.parse(authUrl));

  // Step 3: Show progress while polling
  return vscode.window.withProgress<string>(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Login to ${config.name}`,
      cancellable: true
    },
    async (progress, token) => {
      progress.report({
        message: `Open the browser and enter code: **${deviceCode.user_code}**\n${deviceCode.verification_uri}`
      });

      try {
        const tokenResponse = await pollForToken(
          config,
          deviceCode.device_code,
          deviceCode.interval,
          deviceCode.expires_in,
          token
        );

        // Store the token
        const oauthToken: OAuthToken = {
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token || '',
          expires_at: Date.now() + (tokenResponse.expires_in * 1000),
          token_type: tokenResponse.token_type || 'Bearer',
          scope: tokenResponse.scope || config.scope
        };

        await storeToken(providerId, oauthToken);

        vscode.window.showInformationMessage(
          `✅ Logged in to ${config.name} successfully!`
        );

        return oauthToken.access_token;
      } catch (err: any) {
        vscode.window.showErrorMessage(`Login failed: ${err.message}`);
        throw err;
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logoutOAuth(providerId: string): Promise<void> {
  await clearToken(providerId);
  vscode.window.showInformationMessage(`Logged out from ${OAUTH_PROVIDERS[providerId]?.name || providerId}`);
}

// ---------------------------------------------------------------------------
// Status Check
// ---------------------------------------------------------------------------

export async function getOAuthStatus(providerId: string): Promise<{
  loggedIn: boolean;
  expiresAt?: number;
  providerName: string;
}> {
  const config = OAUTH_PROVIDERS[providerId];
  const token = await getStoredToken(providerId);

  return {
    loggedIn: !!token && token.expires_at > Date.now(),
    expiresAt: token?.expires_at,
    providerName: config?.name || providerId
  };
}

// ---------------------------------------------------------------------------
// Integration Helper: Get API key with OAuth fallback
// ---------------------------------------------------------------------------

/**
 * Resolve API key for a provider:
 * 1. User-configured API key (from settings)
 * 2. OAuth token (if logged in)
 * Returns { apiKey, isOAuth } or null if neither available.
 */
export async function resolveApiKey(
  providerId: string,
  settingsApiKey: string
): Promise<{ apiKey: string; isOAuth: boolean } | null> {
  // Priority 1: User-configured API key
  if (settingsApiKey) {
    return { apiKey: settingsApiKey, isOAuth: false };
  }

  // Priority 2: OAuth token
  const oauthToken = await getValidToken(providerId);
  if (oauthToken) {
    return { apiKey: oauthToken, isOAuth: true };
  }

  return null;
}
