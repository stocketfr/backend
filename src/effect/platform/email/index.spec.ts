import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { createMailer } from '../../../email/mailer';
import {
  createMemoryTransport,
  type MemoryTransport,
} from '../../../email/memory-transport';
import type { EmailTransport } from '../../../email/types';
import { TEST_EMAIL_FROM } from '../../testing/email-test';
import { CurrentRequestContext, type RequestContext } from '../request-context';
import { DEFAULT_TENANT_ID } from '../tenant-constants';
import { EmailSendError, makeEmailService, type EmailService } from './index';

const TEMPLATE = {
  kind: 'reset-password',
  userName: 'Jeanne',
  actionUrl: 'https://app.stocket.test/reset-password?token=abc',
} as const;

const failingTransport: EmailTransport = {
  name: 'failing',
  send: () => Promise.reject(new Error('boom')),
};

const makeMemoryService = (): {
  service: EmailService;
  memory: MemoryTransport;
} => {
  const memory = createMemoryTransport();
  return {
    memory,
    service: makeEmailService(
      createMailer({ transport: memory.transport, from: TEST_EMAIL_FROM }),
    ),
  };
};

const makeFailingService = (): EmailService =>
  makeEmailService(createMailer({ transport: failingTransport, from: TEST_EMAIL_FROM }));

const makeRequestContext = (locale: RequestContext['locale']): RequestContext => ({
  requestId: '00000000-0000-4000-8000-000000000042',
  path: '/api/v1/users',
  method: 'POST',
  ip: null,
  locale,
  tenantId: DEFAULT_TENANT_ID,
  tenantName: 'Default',
  tenantSlug: 'default',
});

const run = <A, E>(effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(effect as Effect.Effect<A, E>);

const waitForDelivery = async (memory: MemoryTransport) => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (memory.sent.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for email delivery');
};

describe('EmailService', () => {
  it('sendOrFail renders the template and delivers via the transport', async () => {
    const { service, memory } = makeMemoryService();

    await run(
      service.sendOrFail({ to: 'jeanne@stocket.test', template: TEMPLATE, locale: 'fr' }),
    );

    expect(memory.sent).toHaveLength(1);
    expect(memory.sent[0]?.to).toBe('jeanne@stocket.test');
    expect(memory.sent[0]?.from).toBe(TEST_EMAIL_FROM);
    expect(memory.sent[0]?.subject).toBe('Réinitialisation de votre mot de passe');
    expect(memory.sent[0]?.text).toContain(TEMPLATE.actionUrl);
  });

  it('sendOrFail falls back to the request-context locale', async () => {
    const { service, memory } = makeMemoryService();

    await run(
      service
        .sendOrFail({ to: 'jeanne@stocket.test', template: TEMPLATE })
        .pipe(
          Effect.provide(
            Layer.succeed(CurrentRequestContext, makeRequestContext('de')),
          ),
        ),
    );

    expect(memory.sent[0]?.subject).toBe('Zurücksetzen Ihres Passworts');
  });

  it('sendOrFail maps transport failures to EmailSendError', async () => {
    const service = makeFailingService();

    const error = await run(
      Effect.flip(
        service.sendOrFail({ to: 'jeanne@stocket.test', template: TEMPLATE, locale: 'en' }),
      ),
    );

    expect(error).toBeInstanceOf(EmailSendError);
    expect(error.messageKey).toBe('email.sendFailed');
  });

  it('send is fire-and-forget and survives transport failures', async () => {
    const service = makeFailingService();

    await expect(
      run(service.send({ to: 'jeanne@stocket.test', template: TEMPLATE, locale: 'en' })),
    ).resolves.toBeUndefined();
  });

  it('send eventually delivers through a working transport', async () => {
    const { service, memory } = makeMemoryService();

    await run(
      service.send({ to: 'jeanne@stocket.test', template: TEMPLATE, locale: 'en' }),
    );
    await waitForDelivery(memory);

    expect(memory.sent[0]?.subject).toBe('Reset your password');
  });
});
