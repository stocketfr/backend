import { createConsoleTransport } from './transports/console';
import { createResendTransport } from './transports/resend';
import type { EmailTransport } from './types';
import { readOptionalEnv, readRequiredEnv } from '@stocket/types/common';

// Used only outside provider runtimes; staging/production must configure a sender.
export const DEV_FALLBACK_FROM = 'Stocket <onboarding@resend.dev>';

const isProviderRuntime = (nodeEnv: string | undefined) =>
  nodeEnv === 'staging' || nodeEnv === 'production';

export const resolveDefaultFromAddress = (): string =>
  isProviderRuntime(process.env.NODE_ENV)
    ? readRequiredEnv('EMAIL_FROM')
    : (readOptionalEnv('EMAIL_FROM') ?? DEV_FALLBACK_FROM);

export const resolveDefaultTransport = (): EmailTransport => {
  const nodeEnv = process.env.NODE_ENV;
  if (!isProviderRuntime(nodeEnv)) {
    return createConsoleTransport();
  }

  return createResendTransport({
    apiKey: readRequiredEnv('RESEND_API_KEY'),
  });
};
