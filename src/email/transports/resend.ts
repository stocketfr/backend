import type { EmailMessage, EmailTransport, SentEmail } from '../types';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export class ResendApiError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
    readonly from: string,
  ) {
    super(
      `Resend API responded with ${status} for from="${from}": ${responseBody}`,
    );
    this.name = 'ResendApiError';
  }
}

export interface ResendTransportOptions {
  readonly apiKey: string;
  readonly fetchFn?: typeof globalThis.fetch;
}

export const createResendTransport = (
  options: ResendTransportOptions,
): EmailTransport => ({
  send: async (message: EmailMessage): Promise<SentEmail> => {
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    console.info(`[email:resend] from="${message.from}"`);
    const response = await fetchFn(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      throw new ResendApiError(response.status, responseBody, message.from);
    }

    const data = (await response.json().catch(() => null)) as {
      id?: string;
    } | null;
    return { id: data?.id ?? null };
  },
});
