import type { SentSms, SmsTransport } from './types';

export interface SendSmsParams {
  readonly to: string;
  readonly body: string;
}

// SMS analogue of Mailer. Today it only attaches the configured sender and
// delegates to the transport; in Phase 2 this is where localized body
// rendering (the SMS counterpart of renderEmail) will live.
export interface Texter {
  readonly transportName: string;
  readonly send: (params: SendSmsParams) => Promise<SentSms>;
}

export interface CreateTexterOptions {
  readonly transport: SmsTransport;
  readonly from: string;
}

export const createTexter = (options: CreateTexterOptions): Texter => ({
  transportName: options.transport.name,
  send: ({ to, body }: SendSmsParams) =>
    options.transport.send({ to, from: options.from, body }),
});
