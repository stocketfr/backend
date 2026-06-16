import { createStubSmsTransport } from './stub-transport';
import { createTexter, type Texter } from './texter';
import type { SmsTransport } from './types';

// Phase 2: no real SMS provider is wired yet, so this always resolves the stub
// transport. When a provider lands, switch on its credentials here (mirroring
// default-mailer's RESEND_API_KEY check) and the rest of the pipeline is unchanged.
const resolveTransport = (): SmsTransport => createStubSmsTransport();

export const defaultTexter: Texter = createTexter({
  transport: resolveTransport(),
  from: process.env.SMS_FROM ?? 'Stocket',
});
