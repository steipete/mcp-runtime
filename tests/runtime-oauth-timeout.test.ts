import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OAuthSession } from '../src/oauth.js';
import { OAuthTimeoutError, waitForAuthorizationCodeWithTimeout } from '../src/runtime/oauth.js';

describe('waitForAuthorizationCodeWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects when the authorization code is not received before the timeout', async () => {
    vi.useFakeTimers();
    const session: OAuthSession = {
      provider: {
        waitForAuthorizationCode: vi.fn(),
      } as unknown as OAuthSession['provider'],
      waitForAuthorizationCode: vi.fn(() => new Promise<string>(() => {})),
      close: vi.fn(async () => {}),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const promise = waitForAuthorizationCodeWithTimeout(session, logger, 'fake', 1_000);
    const expectation = expect(promise).rejects.toBeInstanceOf(OAuthTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('timed out after 1s'));
  });

  it('resolves when the authorization code arrives before the timeout', async () => {
    vi.useFakeTimers();
    let resolveCode: ((value: string) => void) | undefined;
    const session: OAuthSession = {
      provider: {
        waitForAuthorizationCode: vi.fn(),
      } as unknown as OAuthSession['provider'],
      waitForAuthorizationCode: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveCode = resolve;
          })
      ),
      close: vi.fn(async () => {}),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const promise = waitForAuthorizationCodeWithTimeout(session, logger, 'fake', 1_000);
    const expectation = expect(promise).resolves.toBe('abc123');
    resolveCode?.('abc123');
    await vi.advanceTimersByTimeAsync(0);
    await expectation;
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
