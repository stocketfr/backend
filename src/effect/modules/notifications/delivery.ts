import { Effect, Schedule } from 'effect';
import { NotificationChannel } from '@stocket/types/notifications';
import type { SendTemplateParams } from '../../../email/mailer';
import type { SentEmail } from '../../../email/types';
import {
  buildDedupeKey,
  describeError,
  eventCategory,
  toEmailTemplate,
  toNotificationDay,
} from './notifications.utils';
import { NotificationSendError } from './notifications.errors';
import type { NotificationEvent, Recipient } from './types';
import type { RecordPendingParams } from './repository';

const EMAIL_RETRY = Schedule.exponential('200 millis').pipe(
  Schedule.intersect(Schedule.recurs(3)),
);

export interface NotificationDeliveryRepository {
  readonly recordPending: (
    params: RecordPendingParams,
  ) => Effect.Effect<string | null, unknown>;
  readonly markSent: (
    id: string,
    providerMessageId: string | null,
  ) => Effect.Effect<unknown, unknown>;
  readonly markFailed: (
    id: string,
    error: string,
  ) => Effect.Effect<unknown, unknown>;
}

interface NotificationDeliveryWorkflowOptions {
  readonly repository: NotificationDeliveryRepository;
  readonly sendEmail: (params: SendTemplateParams) => Promise<SentEmail>;
  readonly now: () => Date;
}

export const makeNotificationDeliveryWorkflows = ({
  repository,
  sendEmail,
  now,
}: NotificationDeliveryWorkflowOptions) => {
  const deliverEmail = (
    recipient: Recipient,
    event: NotificationEvent,
    notificationId: string,
  ) =>
    Effect.tryPromise({
      try: () =>
        sendEmail({
          to: recipient.email,
          template: toEmailTemplate(event),
          locale: recipient.locale,
        }),
      catch: (cause) =>
        new NotificationSendError({
          channel: 'email',
          cause,
          messageKey: 'notifications.sendFailed',
        }),
    }).pipe(
      Effect.retry(EMAIL_RETRY),
      Effect.matchEffect({
        onFailure: (error) =>
          repository
            .markFailed(notificationId, describeError(error.cause))
            .pipe(Effect.ignore),
        onSuccess: (sent) =>
          repository.markSent(notificationId, sent.id).pipe(Effect.ignore),
      }),
    );

  const notify = (recipient: Recipient, event: NotificationEvent) =>
    Effect.gen(function* () {
      const notificationId = yield* repository.recordPending({
        userId: recipient.userId,
        eventKind: event.kind,
        category: eventCategory(event.kind),
        channel: NotificationChannel.EMAIL,
        dedupeKey: buildDedupeKey(
          event,
          recipient.userId,
          toNotificationDay(now()),
        ),
      });
      if (notificationId === null) return;

      yield* deliverEmail(recipient, event, notificationId);
    }).pipe(
      Effect.catchAll((cause) =>
        Effect.logError({ messageKey: 'notifications.sendFailed', cause }),
      ),
    );

  return {
    deliverEmail,
    notify,
  };
};
