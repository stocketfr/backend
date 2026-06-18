import type { EmailMessage, EmailTransport, SentEmail } from '../types';

const URL_PATTERN = /https?:\/\/\S+/g;

const extractUniqueUrls = (text: string): readonly string[] => [
  ...new Set(text.match(URL_PATTERN) ?? []),
];

// Dev fallback when RESEND_API_KEY is unset: verification/reset links must be
// copy-pasteable from the backend logs, so the action URLs are printed in full.
export const createConsoleTransport = (): EmailTransport => ({
  send: (message: EmailMessage): Promise<SentEmail> => {
    const urls = extractUniqueUrls(message.text);
    console.info(
      [
        `[email:console] from="${message.from}" to=${message.to} subject="${message.subject}"`,
        ...urls.map((url) => `[email:console]   link: ${url}`),
      ].join('\n'),
    );
    return Promise.resolve({ id: null });
  },
});
