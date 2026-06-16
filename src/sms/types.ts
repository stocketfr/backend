export interface SmsMessage {
  readonly to: string;
  readonly from: string;
  readonly body: string;
}

export interface SentSms {
  readonly id: string | null;
}

export interface SmsTransport {
  readonly name: string;
  readonly send: (message: SmsMessage) => Promise<SentSms>;
}
