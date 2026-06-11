import type { EmailMessage, EmailTransport, SentEmail } from './types';

const URL_PATTERN = /https?:\/\/\S+/g;

// Dev fallback when RESEND_API_KEY is unset: verification/reset links must be
// copy-pasteable from the backend logs, so the action URLs are printed in full.
export const createConsoleTransport = (): EmailTransport => ({
  name: 'console',
  send: (message: EmailMessage): Promise<SentEmail> => {
    const urls = [...new Set(message.text.match(URL_PATTERN) ?? [])];
    console.info(
      [
        `[email:console] to=${message.to} subject="${message.subject}"`,
        ...urls.map((url) => `[email:console]   link: ${url}`),
      ].join('\n'),
    );
    return Promise.resolve({ id: null });
  },
});
