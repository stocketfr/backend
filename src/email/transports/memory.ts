import type { EmailMessage, EmailTransport, SentEmail } from '../types';

export interface MemoryTransport {
  readonly transport: EmailTransport;
  readonly sent: EmailMessage[];
}

export const createMemoryTransport = (): MemoryTransport => {
  const sent: EmailMessage[] = [];
  return {
    sent,
    transport: {
      send: (message: EmailMessage): Promise<SentEmail> => {
        sent.push(message);
        return Promise.resolve({ id: `memory-${sent.length}` });
      },
    },
  };
};
