import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ServerDefinition } from '../config.js';
import { resolveEnvValue, withEnvOverrides } from '../env.js';
import type { Logger } from '../logging.js';
import { createOAuthSession, type OAuthSession } from '../oauth.js';
import { readCachedAccessToken } from '../oauth-persistence.js';
import { materializeHeaders } from '../runtime-header-utils.js';
import { analyzeConnectionError } from '../error-classifier.js';
import { isUnauthorizedError, maybeEnableOAuth } from '../runtime-oauth-support.js';
import { closeTransportAndWait } from '../runtime-process-utils.js';
import { connectWithAuth, OAuthTimeoutError } from './oauth.js';
import { resolveCommandArgument, resolveCommandArguments } from './utils.js';

const STDIO_TRACE_ENABLED = process.env.MCPORTER_STDIO_TRACE === '1';
const REGISTRATION_TOKEN_ENV = 'MCPORTER_OAUTH_REGISTRATION_TOKEN';
const REGISTRATION_HEADER_ENV = 'MCPORTER_OAUTH_REGISTRATION_HEADER';

function attachStdioTraceLogging(_transport: StdioClientTransport, _label?: string): void {
  // STDIO instrumentation is handled via sdk-patches side effects. This helper remains
  // so runtime callers can opt-in without sprinkling conditional checks everywhere.
}

function resolveFetchUrl(input: RequestInfo | URL): URL | undefined {
  if (typeof input === 'string') {
    try {
      return new URL(input);
    } catch {
      return undefined;
    }
  }
  if (input instanceof URL) {
    return input;
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      return new URL(input.url);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isRegistrationRequest(url: URL | undefined, method: string): boolean {
  if (!url) {
    return false;
  }
  if (method.toUpperCase() !== 'POST') {
    return false;
  }
  return url.pathname.endsWith('/register');
}

function createOAuthFetch(logger: Logger): typeof fetch {
  const rawHeaderName = process.env[REGISTRATION_HEADER_ENV]?.trim();
  const rawToken = process.env[REGISTRATION_TOKEN_ENV]?.trim();
  const headerName = rawHeaderName && rawHeaderName.length > 0 ? rawHeaderName : 'Authorization';
  const headerValue =
    rawToken && headerName.toLowerCase() === 'authorization' ? `Bearer ${rawToken}` : rawToken ?? undefined;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveFetchUrl(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const isRegistration = isRegistrationRequest(url, method);
    let nextInit = init;

    if (isRegistration) {
      if (headerValue) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set(headerName, headerValue);
        nextInit = { ...init, headers };
        logger.debug?.(
          `OAuth registration request: ${url?.toString() ?? 'unknown'} (added header ${headerName}).`
        );
      } else {
        logger.debug?.(
          `OAuth registration request: ${url?.toString() ?? 'unknown'} (no registration token provided).`
        );
      }
      if (typeof init?.body === 'string') {
        const bodyPreview = init.body.length > 500 ? `${init.body.slice(0, 500)}...` : init.body;
        logger.debug?.(`OAuth registration payload: ${bodyPreview}`);
      }
    }

    const response = await fetch(input as RequestInfo, nextInit);
    if (isRegistration) {
      logger.debug?.(
        `OAuth registration response: ${response.status} ${response.statusText || ''}`.trim()
      );
    }
    return response;
  };
}

export interface ClientContext {
  readonly client: Client;
  readonly transport: Transport & { close(): Promise<void> };
  readonly definition: ServerDefinition;
  readonly oauthSession?: OAuthSession;
}

export interface CreateClientContextOptions {
  readonly maxOAuthAttempts?: number;
  readonly oauthTimeoutMs?: number;
  readonly onDefinitionPromoted?: (definition: ServerDefinition) => void;
  readonly allowCachedAuth?: boolean;
}

export async function createClientContext(
  definition: ServerDefinition,
  logger: Logger,
  clientInfo: { name: string; version: string },
  options: CreateClientContextOptions = {}
): Promise<ClientContext> {
  const client = new Client(clientInfo);
  let activeDefinition = definition;
  logger.debug?.(
    `createClientContext: name=${definition.name}, auth=${definition.auth ?? 'none'}, kind=${definition.command.kind}, maxOAuthAttempts=${
      options.maxOAuthAttempts ?? 'default'
    }, allowCachedAuth=${options.allowCachedAuth ? 'true' : 'false'}.`
  );

  if (options.allowCachedAuth && activeDefinition.auth === 'oauth' && activeDefinition.command.kind === 'http') {
    try {
      const cached = await readCachedAccessToken(activeDefinition, logger);
      if (cached) {
        const existingHeaders = activeDefinition.command.headers ?? {};
        if (!('Authorization' in existingHeaders)) {
          activeDefinition = {
            ...activeDefinition,
            command: {
              ...activeDefinition.command,
              headers: {
                ...existingHeaders,
                Authorization: `Bearer ${cached}`,
              },
            },
          };
          logger.debug?.(`Using cached OAuth access token for '${activeDefinition.name}' (non-interactive).`);
        }
      }
    } catch (error) {
      logger.debug?.(
        `Failed to read cached OAuth token for '${activeDefinition.name}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return withEnvOverrides(activeDefinition.env, async () => {
    if (activeDefinition.command.kind === 'stdio') {
      const resolvedEnvOverrides =
        activeDefinition.env && Object.keys(activeDefinition.env).length > 0
          ? Object.fromEntries(
              Object.entries(activeDefinition.env)
                .map(([key, raw]) => [key, resolveEnvValue(raw)])
                .filter(([, value]) => value !== '')
            )
          : undefined;
      const mergedEnv =
        resolvedEnvOverrides && Object.keys(resolvedEnvOverrides).length > 0
          ? { ...process.env, ...resolvedEnvOverrides }
          : { ...process.env };
      const transport = new StdioClientTransport({
        command: resolveCommandArgument(activeDefinition.command.command),
        args: resolveCommandArguments(activeDefinition.command.args),
        cwd: activeDefinition.command.cwd,
        env: mergedEnv,
      });
      if (STDIO_TRACE_ENABLED) {
        attachStdioTraceLogging(transport, activeDefinition.name ?? activeDefinition.command.command);
      }
      try {
        await client.connect(transport);
      } catch (error) {
        await closeTransportAndWait(logger, transport).catch(() => {});
        throw error;
      }
      return { client, transport, definition: activeDefinition, oauthSession: undefined };
    }

    while (true) {
      const command = activeDefinition.command;
      if (command.kind !== 'http') {
        throw new Error(`Server '${activeDefinition.name}' is not configured for HTTP transport.`);
      }
      let oauthSession: OAuthSession | undefined;
      const shouldEstablishOAuth = activeDefinition.auth === 'oauth' && options.maxOAuthAttempts !== 0;
      if (shouldEstablishOAuth) {
        logger.debug?.(`Creating OAuth session for '${activeDefinition.name}'.`);
        oauthSession = await createOAuthSession(activeDefinition, logger);
      } else {
        if (activeDefinition.auth !== 'oauth') {
          logger.debug?.(`OAuth session skipped for '${activeDefinition.name}': auth=${activeDefinition.auth ?? 'none'}.`);
        } else {
          logger.debug?.(`OAuth session skipped for '${activeDefinition.name}': maxOAuthAttempts=0.`);
        }
      }

      const resolvedHeaders = materializeHeaders(command.headers, activeDefinition.name);
      const requestInit: RequestInit | undefined = resolvedHeaders
        ? { headers: resolvedHeaders as HeadersInit }
        : undefined;
      const oauthFetch = oauthSession ? createOAuthFetch(logger) : undefined;
      const baseOptions = {
        requestInit,
        authProvider: oauthSession?.provider,
        fetch: oauthFetch,
      };

      const attemptConnect = async () => {
        const streamableTransport = new StreamableHTTPClientTransport(command.url, baseOptions);
        try {
          await connectWithAuth(client, streamableTransport, oauthSession, logger, {
            serverName: activeDefinition.name,
            maxAttempts: options.maxOAuthAttempts,
            oauthTimeoutMs: options.oauthTimeoutMs,
          });
          return {
            client,
            transport: streamableTransport,
            definition: activeDefinition,
            oauthSession,
          } as ClientContext;
        } catch (error) {
          await closeTransportAndWait(logger, streamableTransport).catch(() => {});
          throw error;
        }
      };

      try {
        return await attemptConnect();
      } catch (primaryError) {
        const primaryIssue = analyzeConnectionError(primaryError);
        logger.debug?.(
          `Streamable HTTP connect failed for '${activeDefinition.name}': kind=${primaryIssue.kind}, status=${
            primaryIssue.statusCode ?? 'n/a'
          }, message=${primaryIssue.rawMessage}`
        );
        if (isUnauthorizedError(primaryError)) {
          await oauthSession?.close().catch(() => {});
          oauthSession = undefined;
          if (options.maxOAuthAttempts !== 0) {
            const promoted = maybeEnableOAuth(activeDefinition, logger);
            if (promoted) {
              activeDefinition = promoted;
              options.onDefinitionPromoted?.(promoted);
              continue;
            }
          }
        }
        if (primaryError instanceof OAuthTimeoutError) {
          await oauthSession?.close().catch(() => {});
          throw primaryError;
        }
        if (primaryError instanceof Error) {
          logger.info(`Falling back to SSE transport for '${activeDefinition.name}': ${primaryError.message}`);
        }
        const sseTransport = new SSEClientTransport(command.url, {
          ...baseOptions,
        });
        try {
          await connectWithAuth(client, sseTransport, oauthSession, logger, {
            serverName: activeDefinition.name,
            maxAttempts: options.maxOAuthAttempts,
            oauthTimeoutMs: options.oauthTimeoutMs,
          });
          return { client, transport: sseTransport, definition: activeDefinition, oauthSession };
        } catch (sseError) {
          const sseIssue = analyzeConnectionError(sseError);
          logger.debug?.(
            `SSE connect failed for '${activeDefinition.name}': kind=${sseIssue.kind}, status=${
              sseIssue.statusCode ?? 'n/a'
            }, message=${sseIssue.rawMessage}`
          );
          await closeTransportAndWait(logger, sseTransport).catch(() => {});
          await oauthSession?.close().catch(() => {});
          if (sseError instanceof OAuthTimeoutError) {
            throw sseError;
          }
          if (isUnauthorizedError(sseError) && options.maxOAuthAttempts !== 0) {
            const promoted = maybeEnableOAuth(activeDefinition, logger);
            if (promoted) {
              activeDefinition = promoted;
              options.onDefinitionPromoted?.(promoted);
              continue;
            }
          }
          throw sseError;
        }
      }
    }
  });
}
