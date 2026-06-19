import { createConsoleTransport } from './transports/console';
import { createResendTransport } from './transports/resend';
import type { EmailTransport } from './types';

// Used when a real provider send is enabled but no branded sender was set.
// Development does not use the provider at all; it logs simulated emails.
export const DEV_FALLBACK_FROM = 'Stocket <onboarding@resend.dev>';

export const resolveDefaultTransport = (): EmailTransport => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const shouldUseProvider = nodeEnv === 'staging' || nodeEnv === 'production';
  if (!shouldUseProvider) {
    return createConsoleTransport();
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return createResendTransport({ apiKey });
  }

  if (nodeEnv === 'production') {
    throw new Error(
      'RESEND_API_KEY environment variable is required in production',
    );
  }

  return createConsoleTransport();
};
