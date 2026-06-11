import { type Layer } from 'effect';
import { createMailer } from '../../email/mailer';
import {
  createMemoryTransport,
  type MemoryTransport,
} from '../../email/memory-transport';
import { type EmailService, makeEmailServiceLayer } from '../platform/email';

export const TEST_EMAIL_FROM = 'Stocket Test <test@stocket.test>';

export interface EmailTestHarness {
  readonly layer: Layer.Layer<EmailService>;
  readonly sent: MemoryTransport['sent'];
}

/**
 * Memory-backed `EmailService` for tests: nothing leaves the process, and
 * every message is captured on `sent` for assertions.
 */
export const makeEmailTestLayer = (): EmailTestHarness => {
  const memory = createMemoryTransport();
  return {
    sent: memory.sent,
    layer: makeEmailServiceLayer(
      createMailer({ transport: memory.transport, from: TEST_EMAIL_FROM }),
    ),
  };
};
