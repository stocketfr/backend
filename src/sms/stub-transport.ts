import type { SentSms, SmsMessage, SmsTransport } from './types';

// Thrown by the stub so an attempted SMS fails loudly and is recorded as a
// `failed` ledger row with this reason, rather than silently disappearing.
export class SmsNotImplementedError extends Error {
  constructor() {
    super('SMS delivery is not implemented yet (Phase 2).');
    this.name = 'SmsNotImplementedError';
  }
}

// Phase 2 placeholder. The SMS channel is modeled end-to-end (preferences,
// audience resolution, ledger), but no provider is wired yet. This transport
// keeps the seam real: swap it for a Twilio/etc. transport in default-texter.ts
// without touching the texter or the notifications service. Until then a send
// logs and rejects, so an opted-in recipient gets an honest failed row.
export const createStubSmsTransport = (): SmsTransport => ({
  name: 'stub',
  send: (message: SmsMessage): Promise<SentSms> => {
    console.warn(
      `[sms:stub] no SMS provider configured; dropping message to ${message.to}`,
    );
    return Promise.reject(new SmsNotImplementedError());
  },
});
