import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResendTransport, ResendApiError } from './resend';

const message = {
  from: 'Stocket <hello@stocket.test>',
  to: 'jeanne@stocket.test',
  subject: 'Welcome',
  html: '<p>Welcome</p>',
  text: 'Welcome',
};

describe('Resend email transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the from field before sending an email', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetchFn: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 });
    const transport = createResendTransport({ apiKey: 'test-key', fetchFn });

    await transport.send(message);

    expect(info).toHaveBeenCalledWith(
      '[email:resend] from="Stocket <hello@stocket.test>"',
    );
  });

  it('includes the rejected from field in Resend API errors', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const responseBody =
      '{"statusCode":422,"name":"validation_error","message":"Invalid `from` field."}';
    const fetchFn: typeof globalThis.fetch = async () =>
      new Response(responseBody, { status: 422 });
    const transport = createResendTransport({ apiKey: 'test-key', fetchFn });

    let caught: unknown;
    try {
      await transport.send(message);
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof ResendApiError)) {
      throw new Error('Expected ResendApiError');
    }

    expect(caught.status).toBe(422);
    expect(caught.responseBody).toBe(responseBody);
    expect(caught.from).toBe('Stocket <hello@stocket.test>');
    expect(caught.message).toContain('for from="Stocket <hello@stocket.test>"');
  });
});
