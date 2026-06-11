import { createConsoleTransport } from './console-transport';
import { createMailer, type Mailer } from './mailer';
import { createResendTransport } from './resend-transport';
import type { EmailTransport } from './types';

// Resend's shared onboarding sender only delivers to the account owner's own
// address, which is exactly the safety net wanted outside production.
const DEV_FALLBACK_FROM = 'Stocket <onboarding@resend.dev>';

const resolveTransport = (): EmailTransport => {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return createResendTransport({ apiKey });
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'RESEND_API_KEY environment variable is required in production',
    );
  }

  return createConsoleTransport();
};

export const defaultMailer: Mailer = createMailer({
  transport: resolveTransport(),
  from: process.env.EMAIL_FROM ?? DEV_FALLBACK_FROM,
});
