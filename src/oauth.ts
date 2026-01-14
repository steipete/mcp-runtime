import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { ServerDefinition } from './config.js';
import type { OAuthPersistence } from './oauth-persistence.js';
import { buildOAuthPersistence } from './oauth-persistence.js';
import { discoverOAuthMetadata, resolveOAuthScope } from './oauth-discovery.js';

const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/';
const DEFAULT_CALLBACK_PORT = 33418;
const DEFAULT_CLIENT_URI = 'https://github.com/steipete/mcporter';
const DEFAULT_GRANT_TYPES = ['authorization_code', 'refresh_token'];

type OAuthClientMetadataWithApplication = OAuthClientMetadata & {
  application_type?: 'native';
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

// createDeferred produces a minimal promise wrapper for async coordination.
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// openExternal attempts to launch the system browser cross-platform.
function openExternal(url: string) {
  const platform = process.platform;
  const stdio = 'ignore';
  try {
    if (platform === 'darwin') {
      const child = spawn('open', [url], { stdio, detached: true });
      child.unref();
    } else if (platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '""', url], {
        stdio,
        detached: true,
      });
      child.unref();
    } else {
      const child = spawn('xdg-open', [url], { stdio, detached: true });
      child.unref();
    }
  } catch {
    // best-effort: fall back to printing URL
  }
}

// PersistentOAuthClientProvider persists OAuth session artifacts to disk and captures callback redirects.
class PersistentOAuthClientProvider implements OAuthClientProvider {
  private readonly metadata: OAuthClientMetadata;
  private readonly logger: OAuthLogger;
  private readonly persistence: OAuthPersistence;
  private redirectUrlValue: URL;
  private authorizationStarted = false;
  private authorizationDeferred: Deferred<string> | null = null;
  private server?: http.Server;

  private constructor(
    private readonly definition: ServerDefinition,
    persistence: OAuthPersistence,
    redirectUrl: URL,
    logger: OAuthLogger,
    clientMetadata: OAuthClientMetadata
  ) {
    this.redirectUrlValue = redirectUrl;
    this.logger = logger;
    this.persistence = persistence;
    this.metadata = clientMetadata;
    this.logger.debug?.(`OAuth redirect URL set to ${this.redirectUrlValue.toString()}.`);
    this.logger.debug?.(
      `OAuth client metadata: scope=${this.metadata.scope ?? 'none'}, redirect=${this.redirectUrlValue.toString()}`
    );
  }

  static async create(
    definition: ServerDefinition,
    logger: OAuthLogger
  ): Promise<{
    provider: PersistentOAuthClientProvider;
    close: () => Promise<void>;
  }> {
    const persistence = await buildOAuthPersistence(definition, logger);

    const server = http.createServer();
    const overrideRedirect = definition.oauthRedirectUrl ? new URL(definition.oauthRedirectUrl) : null;
    const listenHost = overrideRedirect?.hostname ?? CALLBACK_HOST;
    const overridePort = overrideRedirect?.port ?? '';
    const usesDynamicPort = !overrideRedirect || overridePort === '' || overridePort === '0';
    const shouldPreferStablePort = !overrideRedirect;
    const desiredPort = usesDynamicPort ? undefined : Number.parseInt(overridePort, 10);
    const callbackPath =
      overrideRedirect?.pathname && overrideRedirect.pathname !== '/' ? overrideRedirect.pathname : CALLBACK_PATH;
    const listenServer = (portToUse: number) =>
      new Promise<number>((resolve, reject) => {
        const onError = (error: unknown) => reject(error);
        server.once('error', onError);
        server.listen(portToUse, listenHost, () => {
          server.off('error', onError);
          const address = server.address();
          if (typeof address === 'object' && address && 'port' in address) {
            resolve(address.port);
          } else {
            reject(new Error('Failed to determine callback port'));
          }
        });
      });

    let port: number;
    try {
      if (shouldPreferStablePort) {
        port = await listenServer(DEFAULT_CALLBACK_PORT);
        logger.info(`Using OAuth loopback redirect port ${port} for ${definition.name}.`);
      } else {
        port = await listenServer(desiredPort ?? 0);
      }
    } catch (error) {
      const isAddressInUse =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'EADDRINUSE';
      if (shouldPreferStablePort && isAddressInUse) {
        logger.warn(`Port ${DEFAULT_CALLBACK_PORT} is in use; selecting a random OAuth redirect port instead.`);
        port = await listenServer(desiredPort ?? 0);
      } else {
        throw error;
      }
    }

    const redirectUrl = overrideRedirect
      ? new URL(overrideRedirect.toString())
      : new URL(`http://${listenHost}:${port}${callbackPath}`);
    if (usesDynamicPort) {
      redirectUrl.port = String(port);
    }
    if (!overrideRedirect || overrideRedirect.pathname === '/' || overrideRedirect.pathname === '') {
      redirectUrl.pathname = callbackPath;
    }

    let effectiveScope = 'mcp:tools';
    let authorizationServerMetadata: AuthorizationServerMetadata | undefined;
    if (definition.command.kind === 'http') {
      const discovery = await discoverOAuthMetadata(
        definition.command.url,
        logger
      );
      authorizationServerMetadata = discovery.authorizationServerMetadata;
      const resourceMetadata = discovery.resourceMetadata;
      effectiveScope = resolveOAuthScope({
        resourceMetadata,
        authorizationServerMetadata,
        fallbackScope: effectiveScope,
      });
      logger.info(`Using OAuth scope '${effectiveScope}' for ${definition.name}.`);
    }

    const grantTypes =
      authorizationServerMetadata?.grant_types_supported?.filter((grant) =>
        DEFAULT_GRANT_TYPES.includes(grant)
      ) ?? DEFAULT_GRANT_TYPES;
    if (grantTypes.length === 0) {
      grantTypes.push(...DEFAULT_GRANT_TYPES);
    }

    const redirectUris = new Set<string>();
    if (!overrideRedirect && listenHost === CALLBACK_HOST) {
      redirectUris.add(`http://${CALLBACK_HOST}/`);
      redirectUris.add(`http://${CALLBACK_HOST}:${DEFAULT_CALLBACK_PORT}/`);
    } else {
      redirectUris.add(redirectUrl.toString());
    }

    const clientMetadata: OAuthClientMetadataWithApplication = {
      client_name: definition.clientName ?? `mcporter (${definition.name})`,
      client_uri: DEFAULT_CLIENT_URI,
      redirect_uris: Array.from(redirectUris),
      grant_types: grantTypes,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: effectiveScope,
      application_type: 'native',
    };

    logger.debug?.(
      `OAuth callback listener active at ${redirectUrl.toString()} (host=${listenHost}, port=${port}, path=${redirectUrl.pathname}).`
    );
    logger.debug?.(
      `OAuth registration redirect_uris for ${definition.name}: ${clientMetadata.redirect_uris.join(', ')}.`
    );
    logger.debug?.(
      `OAuth registration grant_types for ${definition.name}: ${(clientMetadata.grant_types ?? []).join(', ')}.`
    );
    const provider = new PersistentOAuthClientProvider(
      definition,
      persistence,
      redirectUrl,
      logger,
      clientMetadata
    );
    provider.attachServer(server);
    return {
      provider,
      close: async () => {
        await provider.close();
      },
    };
  }

  // attachServer listens for the OAuth redirect and resolves/rejects the deferred code promise.
  private attachServer(server: http.Server) {
    this.server = server;
    server.on('request', async (req, res) => {
      try {
        const url = req.url ?? '';
        this.logger.debug?.(`OAuth callback request: ${req.method ?? 'GET'} ${url}`);
        const parsed = new URL(url, this.redirectUrlValue);
        const expectedPath = this.redirectUrlValue.pathname || '/';
        const fallbackPath = expectedPath === '/' ? '/callback' : null;
        if (parsed.pathname !== expectedPath && parsed.pathname !== fallbackPath) {
          this.logger.debug?.(
            `OAuth callback path mismatch. Expected ${expectedPath}${
              fallbackPath ? ` or ${fallbackPath}` : ''
            }, received ${parsed.pathname}.`
          );
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const code = parsed.searchParams.get('code');
        const error = parsed.searchParams.get('error');
        const receivedState = parsed.searchParams.get('state');
        const expectedState = await this.persistence.readState();
        if (expectedState && receivedState && receivedState !== expectedState) {
          this.logger.warn(`OAuth state mismatch for ${this.definition.name}.`);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html');
          res.end('<html><body><h1>Authorization failed</h1><p>Invalid OAuth state</p></body></html>');
          this.authorizationDeferred?.reject(new Error('Invalid OAuth state'));
          this.authorizationDeferred = null;
          return;
        }
        if (code) {
          this.logger.info(`Received OAuth authorization code for ${this.definition.name}`);
          this.logger.debug?.(`OAuth authorization code length: ${code.length}.`);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html');
          res.end('<html><body><h1>Authorization successful</h1><p>You can return to the CLI.</p></body></html>');
          this.authorizationDeferred?.resolve(code);
          this.authorizationDeferred = null;
        } else if (error) {
          this.logger.warn(`OAuth callback returned error for ${this.definition.name}: ${error}`);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html');
          res.end(`<html><body><h1>Authorization failed</h1><p>${error}</p></body></html>`);
          this.authorizationDeferred?.reject(new Error(`OAuth error: ${error}`));
          this.authorizationDeferred = null;
        } else {
          res.statusCode = 400;
          res.end('Missing authorization code');
          this.authorizationDeferred?.reject(new Error('Missing authorization code'));
          this.authorizationDeferred = null;
        }
      } catch (error) {
        this.authorizationDeferred?.reject(error);
        this.authorizationDeferred = null;
      }
    });
  }

  get redirectUrl(): string | URL {
    return this.redirectUrlValue;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.metadata;
  }

  async state(): Promise<string> {
    const existing = await this.persistence.readState();
    if (existing) {
      return existing;
    }
    const state = randomUUID();
    await this.persistence.saveState(state);
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const info = await this.persistence.readClientInfo();
    this.logger.debug?.(
      `Loaded OAuth client information for ${this.definition.name}: ${info ? 'present' : 'missing'}.`
    );
    return info;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.persistence.saveClientInfo(clientInformation);
    this.logger.info(`Saved OAuth client information for ${this.definition.name} (${this.persistence.describe()})`);
    const hasSecret = 'client_secret' in clientInformation && Boolean(clientInformation.client_secret);
    this.logger.debug?.(
      `OAuth client registration for ${this.definition.name} returned ${hasSecret ? 'a client_secret' : 'no client_secret'}.`
    );
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this.persistence.readTokens();
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.persistence.saveTokens(tokens);
    this.logger.info(`Saved OAuth tokens for ${this.definition.name} (${this.persistence.describe()})`);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.logger.info(`Authorization required for ${this.definition.name}. Opening browser...`);
    this.logger.info(`OAuth authorization URL: ${authorizationUrl.toString()}`);
    this.authorizationStarted = true;
    this.authorizationDeferred = createDeferred<string>();
    openExternal(authorizationUrl.toString());
    this.logger.info(`If the browser did not open, visit ${authorizationUrl.toString()} manually.`);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.persistence.saveCodeVerifier(codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const value = await this.persistence.readCodeVerifier();
    if (!value) {
      throw new Error(`Missing PKCE code verifier for ${this.definition.name}`);
    }
    return value.trim();
  }

  // invalidateCredentials removes cached files to force the next OAuth flow.
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    await this.persistence.clear(scope);
  }

  // waitForAuthorizationCode resolves once the local callback server captures a redirect.
  async waitForAuthorizationCode(): Promise<string> {
    if (!this.authorizationDeferred) {
      this.authorizationDeferred = createDeferred<string>();
    }
    return this.authorizationDeferred.promise;
  }

  didStartAuthorization(): boolean {
    return this.authorizationStarted;
  }

  // close stops the temporary callback server created for the OAuth session.
  async close(): Promise<void> {
    if (this.authorizationDeferred) {
      // If the CLI is tearing down mid-flow, reject the pending wait promise so runtime shutdown isn't blocked.
      this.authorizationDeferred.reject(new Error('OAuth session closed before receiving authorization code.'));
      this.authorizationDeferred = null;
    }
    if (!this.server) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = undefined;
  }
}

export interface OAuthSession {
  provider: OAuthClientProvider & {
    waitForAuthorizationCode: () => Promise<string>;
  };
  waitForAuthorizationCode: () => Promise<string>;
  didStartAuthorization: () => boolean;
  close: () => Promise<void>;
}

// createOAuthSession spins up a file-backed OAuth provider and callback server for the target definition.
export async function createOAuthSession(definition: ServerDefinition, logger: OAuthLogger): Promise<OAuthSession> {
  const { provider, close } = await PersistentOAuthClientProvider.create(definition, logger);
  const waitForAuthorizationCode = () => provider.waitForAuthorizationCode();
  const didStartAuthorization = () => provider.didStartAuthorization();
  return {
    provider,
    waitForAuthorizationCode,
    didStartAuthorization,
    close,
  };
}
export interface OAuthLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  debug?(message: string): void;
}
