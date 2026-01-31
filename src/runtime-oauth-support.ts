import type { ServerDefinition } from './config.js';
import { analyzeConnectionError } from './error-classifier.js';
import type { Logger } from './logging.js';

export async function maybeEnableOAuth(definition: ServerDefinition, logger: Logger): Promise<ServerDefinition | undefined> {
  if (definition.auth === 'oauth') {
    return undefined;
  }
  if (definition.command.kind !== 'http') {
    return undefined;
  }
  // For non-ad-hoc servers, verify the server actually supports OAuth
  // by probing for protected resource metadata before promoting.
  const isAdHocSource = definition.source && definition.source.kind === 'local' && definition.source.path === '<adhoc>';
  if (!isAdHocSource) {
    const supportsOAuth = await probeOAuthSupport(definition.command.url, logger);
    if (!supportsOAuth) {
      return undefined;
    }
  }
  logger.info(`Detected OAuth requirement for '${definition.name}'. Launching browser flow...`);
  return {
    ...definition,
    auth: 'oauth',
  };
}

// probeOAuthSupport checks if a server advertises OAuth via RFC 9728 protected resource metadata.
async function probeOAuthSupport(url: URL, logger: Logger): Promise<boolean> {
  const wellKnownUrl = new URL('/.well-known/oauth-protected-resource', url.origin);
  try {
    const response = await fetch(wellKnownUrl.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return false;
    }
    const metadata = (await response.json()) as { authorization_servers?: string[] };
    return Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.length > 0;
  } catch {
    logger.info(`Could not probe OAuth metadata for ${url.origin}; skipping OAuth promotion.`);
    return false;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  const issue = analyzeConnectionError(error);
  return issue.kind === 'auth';
}
