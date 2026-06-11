import { Context, Effect, Layer, Option } from 'effect';
import type { EmailTemplate } from '@stocket/emails';
import { defaultMailer } from '../../../email/default-mailer';
import type { Mailer } from '../../../email/mailer';
import { InternalError } from '../domain-errors';
import {
  DEFAULT_LOCALE,
  type LogPayload,
  type SupportedLocale,
} from '../messages';
import { getOptionalRequestContext } from '../request-context';

export class EmailSendError extends InternalError('EmailSendError')<{
  readonly cause: unknown;
}> {}

export interface SendEmailParams {
  readonly to: string;
  readonly template: EmailTemplate;
  readonly locale?: SupportedLocale;
}

export interface EmailService {
  readonly send: (params: SendEmailParams) => Effect.Effect<void, never, unknown>;
  readonly sendOrFail: (
    params: SendEmailParams,
  ) => Effect.Effect<void, EmailSendError, unknown>;
}

export const EmailService = Context.GenericTag<EmailService>(
  '@stocket/effect/platform/EmailService',
);

export const makeEmailService = (mailer: Mailer): EmailService => {
  const resolveSendLocale = (params: SendEmailParams) =>
    params.locale !== undefined
      ? Effect.succeed(params.locale)
      : Effect.map(getOptionalRequestContext, (requestContext) =>
          Option.match(requestContext, {
            onNone: () => DEFAULT_LOCALE,
            onSome: (context) => context.locale,
          }),
        );

  const sendOrFail = (params: SendEmailParams) =>
    Effect.gen(function* () {
      const locale = yield* resolveSendLocale(params);
      yield* Effect.tryPromise({
        try: () =>
          mailer.send({ to: params.to, template: params.template, locale }),
        catch: (cause) =>
          new EmailSendError({ messageKey: 'email.sendFailed', cause }),
      });
    });

  const send = (params: SendEmailParams) =>
    Effect.gen(function* () {
      yield* Effect.forkDaemon(
        sendOrFail(params).pipe(
          Effect.catchAll((error) =>
            Effect.logError({
              messageKey: 'email.sendFailed',
              to: params.to,
              template: params.template.kind,
              cause: error,
            } satisfies LogPayload),
          ),
        ),
      );
    }).pipe(Effect.asVoid);

  return { send, sendOrFail } satisfies EmailService;
};

export const makeEmailServiceLayer = (mailer: Mailer) =>
  Layer.sync(EmailService, () => makeEmailService(mailer));

export const emailLayer = makeEmailServiceLayer(defaultMailer);
