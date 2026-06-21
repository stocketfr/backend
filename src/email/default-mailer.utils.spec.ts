import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_FALLBACK_FROM,
  resolveDefaultFromAddress,
  resolveDefaultTransport,
} from './default-mailer.utils';

const message = {
  from: 'Stocket <hello@stocket.test>',
  to: 'jeanne@stocket.test',
  subject: 'Welcome',
  html: '<a href="https://stocket.test/welcome">Welcome</a>',
  text: 'Open https://stocket.test/welcome',
};

describe('default mailer transport resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses simulated email in development even when Resend is configured', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchFn = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchFn);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const transport = resolveDefaultTransport();
    await transport.send(message);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      [
        '[email:simulated] from="Stocket <hello@stocket.test>" to=jeanne@stocket.test subject="Welcome"',
        '[email:simulated]   link: https://stocket.test/welcome',
      ].join('\n'),
    );
  });

  it('uses simulated email in test even when Resend is configured', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchFn = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchFn);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const transport = resolveDefaultTransport();
    await transport.send(message);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses Resend outside development when an API key is configured', async () => {
    vi.stubEnv('NODE_ENV', 'staging');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchFn);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const transport = resolveDefaultTransport();
    await transport.send(message);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('requires Resend in provider runtimes', () => {
    vi.stubEnv('NODE_ENV', 'staging');
    vi.stubEnv('RESEND_API_KEY', '');

    expect(() => resolveDefaultTransport()).toThrow(
      'RESEND_API_KEY environment variable is required',
    );
  });

  it('requires Resend in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');

    expect(() => resolveDefaultTransport()).toThrow(
      'RESEND_API_KEY environment variable is required',
    );
  });
});

describe('default sender resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the dev sender fallback outside provider runtimes', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_FROM', '');

    expect(resolveDefaultFromAddress()).toBe(DEV_FALLBACK_FROM);
  });

  it('uses an explicit sender outside provider runtimes when configured', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EMAIL_FROM', 'Stocket <test@stocket.test>');

    expect(resolveDefaultFromAddress()).toBe('Stocket <test@stocket.test>');
  });

  it('requires an explicit sender in provider runtimes', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_FROM', '');

    expect(() => resolveDefaultFromAddress()).toThrow(
      'EMAIL_FROM environment variable is required',
    );
  });
});
