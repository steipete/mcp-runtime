import type { ServerDefinition } from './config.js';
import { analyzeConnectionError } from './error-classifier.js';
import type { Logger } from './logging.js';

export function maybeEnableOAuth(definition: ServerDefinition, logger: Logger): ServerDefinition | undefined {
  if (definition.auth === 'oauth') {
    logger.debug?.(`OAuth already enabled for '${definition.name}'.`);
    return undefined;
  }
  if (definition.command.kind !== 'http') {
    logger.debug?.(`OAuth promotion skipped for '${definition.name}': non-HTTP transport.`);
    return undefined;
  }
  const isAdHocSource = definition.source && definition.source.kind === 'local' && definition.source.path === '<adhoc>';
  if (!isAdHocSource) {
    const sourceInfo = definition.source ? `${definition.source.kind}:${definition.source.path}` : 'none';
    logger.debug?.(`OAuth promotion skipped for '${definition.name}': source=${sourceInfo}.`);
    return undefined;
  }
  logger.info(`Detected OAuth requirement for '${definition.name}'. Launching browser flow...`);
  return {
    ...definition,
    auth: 'oauth',
  };
}

export function isUnauthorizedError(error: unknown): boolean {
  const issue = analyzeConnectionError(error);
  return issue.kind === 'auth';
}
