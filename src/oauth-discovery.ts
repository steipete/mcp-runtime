import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';

type DiscoveryLogger = {
  info?(message: string): void;
  warn?(message: string): void;
};

export type OAuthDiscoveryResult = {
  resourceMetadata?: OAuthProtectedResourceMetadata;
  authorizationServerMetadata?: AuthorizationServerMetadata;
  authorizationServerUrl?: URL;
};

export async function discoverOAuthMetadata(
  resourceUrl: URL,
  logger?: DiscoveryLogger
): Promise<OAuthDiscoveryResult> {
  let resourceMetadata: OAuthProtectedResourceMetadata | undefined;
  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(resourceUrl);
    logger?.info?.(`Discovered OAuth protected resource metadata for ${resourceUrl.toString()}.`);
    if (resourceMetadata.authorization_servers?.length) {
      logger?.info?.(
        `OAuth authorization servers: ${resourceMetadata.authorization_servers.join(', ')}.`
      );
    }
    if (resourceMetadata.scopes_supported?.length) {
      logger?.info?.(`OAuth scopes supported: ${resourceMetadata.scopes_supported.join(' ')}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn?.(`Failed to load OAuth protected resource metadata for ${resourceUrl.toString()}: ${message}`);
  }

  let authorizationServerUrl: URL | undefined;
  const authorizationServer = resourceMetadata?.authorization_servers?.[0];
  if (authorizationServer) {
    try {
      authorizationServerUrl = new URL(authorizationServer);
    } catch {
      authorizationServerUrl = undefined;
    }
  }
  if (!authorizationServerUrl) {
    authorizationServerUrl = new URL('/', resourceUrl);
  }

  let authorizationServerMetadata: AuthorizationServerMetadata | undefined;
  try {
    authorizationServerMetadata = await discoverAuthorizationServerMetadata(authorizationServerUrl);
    if (authorizationServerMetadata) {
      logger?.info?.(
        `Discovered OAuth authorization server metadata at ${authorizationServerUrl.toString()}.`
      );
      if (authorizationServerMetadata.scopes_supported?.length) {
        logger?.info?.(
          `Authorization server scopes supported: ${authorizationServerMetadata.scopes_supported.join(' ')}.`
        );
      }
    } else {
      logger?.warn?.(`OAuth authorization server metadata not found at ${authorizationServerUrl.toString()}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn?.(`Failed to load OAuth authorization server metadata from ${authorizationServerUrl.toString()}: ${message}`);
  }

  return {
    resourceMetadata,
    authorizationServerMetadata,
    authorizationServerUrl,
  };
}

export function resolveOAuthScope(options: {
  resourceMetadata?: OAuthProtectedResourceMetadata;
  authorizationServerMetadata?: AuthorizationServerMetadata;
  fallbackScope?: string;
}): string {
  const supportedScopes =
    options.resourceMetadata?.scopes_supported ?? options.authorizationServerMetadata?.scopes_supported;

  if (supportedScopes && supportedScopes.length > 0) {
    if (supportedScopes.includes('mcp:tools')) {
      return 'mcp:tools';
    }
    if (supportedScopes.includes('mcp:connect')) {
      return 'mcp:connect';
    }
    return supportedScopes[0];
  }

  return options.fallbackScope ?? 'mcp:tools';
}
