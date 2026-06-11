export interface EmailMessage {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface SentEmail {
  readonly id: string | null;
}

export interface EmailTransport {
  readonly name: string;
  readonly send: (message: EmailMessage) => Promise<SentEmail>;
}
