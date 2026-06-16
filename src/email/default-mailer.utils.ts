import { createConsoleTransport } from './transports/console';
import { createResendTransport } from './transports/resend';
import type { EmailTransport } from './types';

// Resend's shared onboarding sender only delivers to the account owner's own
// address, which is exactly the safety net wanted outside production.
export const DEV_FALLBACK_FROM = 'Stocket <onboarding@resend.dev>';

export const resolveDefaultTransport = (): EmailTransport => {
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
