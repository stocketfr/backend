import {
  renderEmail,
  type EmailLocale,
  type EmailTemplate,
} from '@stocket/emails';
import type { EmailTransport, SentEmail } from './types';

export interface SendTemplateParams {
  readonly to: string;
  readonly template: EmailTemplate;
  readonly locale: EmailLocale;
}

export interface Mailer {
  readonly transportName: string;
  readonly send: (params: SendTemplateParams) => Promise<SentEmail>;
}

export interface CreateMailerOptions {
  readonly transport: EmailTransport;
  readonly from: string;
}

export const createMailer = (options: CreateMailerOptions): Mailer => ({
  transportName: options.transport.name,
  send: async ({ to, template, locale }: SendTemplateParams) => {
    const rendered = await renderEmail(template, locale);
    return options.transport.send({
      to,
      from: options.from,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  },
});
