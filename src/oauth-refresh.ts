import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { ServerDefinition } from './config.js';
import type { Logger } from './logging.js';
import { buildOAuthPersistence } from './oauth-persistence.js';
import { loadVaultEntry } from './oauth-vault.js';

/**
 * Attempts to refresh OAuth tokens using the stored refresh_token.
 * Returns the new access token if successful, undefined otherwise.
 */
export async function tryRefreshTokens(
  definition: ServerDefinition,
  logger?: Logger
): Promise<string | undefined> {
  if (definition.command.kind !== 'http') {
    return undefined;
  }

  const entry = await loadVaultEntry(definition);
  if (!entry?.tokens?.refresh_token || !entry?.clientInfo) {
    logger?.debug?.(`No refresh token or client info available for '${definition.name}'`);
    return undefined;
  }

  const { refresh_token } = entry.tokens;
  const { client_id, client_secret } = entry.clientInfo;

  if (!client_id) {
    logger?.debug?.(`No client_id available for '${definition.name}'`);
    return undefined;
  }

  // Derive the token endpoint from the server URL
  // Most OAuth servers use /oauth2/token or /token at the base URL
  const serverUrl = new URL(definition.command.url.toString());
  
  // Try common token endpoint patterns
  const possibleEndpoints = [
    new URL('/oauth2/token', serverUrl.origin),
    new URL('/token', serverUrl.origin),
    new URL('/.well-known/oauth-authorization-server', serverUrl.origin),
  ];

  // For Homey specifically, we know the token endpoint
  if (serverUrl.hostname.includes('athom.com') || serverUrl.hostname.includes('homey')) {
    possibleEndpoints.unshift(new URL('https://api.athom.com/oauth2/token'));
  }

  for (const tokenEndpoint of possibleEndpoints) {
    try {
      const params = new URLSearchParams();
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', refresh_token);
      params.set('client_id', client_id);
      if (client_secret) {
        params.set('client_secret', client_secret);
      }

      const response = await fetch(tokenEndpoint.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const text = await response.text();
        logger?.debug?.(`Token refresh failed at ${tokenEndpoint}: ${response.status} ${text}`);
        continue;
      }

      const newTokens = await response.json() as OAuthTokens;
      
      if (!newTokens.access_token) {
        logger?.debug?.(`Token refresh response missing access_token at ${tokenEndpoint}`);
        continue;
      }

      // Preserve the original refresh_token if the server didn't return a new one
      if (!newTokens.refresh_token) {
        newTokens.refresh_token = refresh_token;
      }

      // Save the new tokens
      const persistence = await buildOAuthPersistence(definition, logger);
      await persistence.saveTokens(newTokens);
      
      logger?.info?.(`Successfully refreshed OAuth token for '${definition.name}'`);
      return newTokens.access_token;
    } catch (error) {
      logger?.debug?.(`Token refresh error at ${tokenEndpoint}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
  }

  logger?.debug?.(`All token refresh attempts failed for '${definition.name}'`);
  return undefined;
}
