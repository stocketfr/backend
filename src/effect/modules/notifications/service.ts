import { Effect, Schedule } from 'effect';
import { v4 as uuidv4 } from 'uuid';
import {
  NotificationCategory,
  NotificationChannel,
  type NotificationPreferencesResponseDto,
} from '@stocket/types/notifications';
import type { EmailTemplate } from '@stocket/emails';
import { defaultMailer } from '../../../email/default-mailer';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import {
  DEFAULT_LOCALE,
  type SupportedLocale,
} from '../../platform/observability/messages';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../platform/http/request-context';
import {
  NotificationsRepository,
  type AudienceCandidate,
  type PreferenceInput,
} from './repository';
import {
  buildDedupeKey,
  effectivePref,
  eventCategory,
} from './notifications.utils';
import { NotificationSendError } from './notifications.errors';
import type { NotificationEvent, Recipient } from './types';

const SCAN_INTERVAL = Schedule.spaced('60 seconds');

// Bounded exponential retry for transient provider failures.
const EMAIL_RETRY = Schedule.exponential('200 millis').pipe(
  Schedule.intersect(Schedule.recurs(3)),
);

// UTC day stamp; embedded in the dedupe key so a condition re-alerts the next
// day but not on every 60s tick within a day.
const currentDay = (): string => new Date().toISOString().slice(0, 10);

const toSupportedLocale = (value: string | null): SupportedLocale =>
  value === 'en' || value === 'fr' || value === 'de' ? value : DEFAULT_LOCALE;

const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    !Array.isArray(error) &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim() !== ''
  ) {
    return error.message;
  }

  return String(error);
};

const toEmailTemplate = (event: NotificationEvent): EmailTemplate => ({
  kind: 'low-stock',
  sku: event.sku,
  productName: event.productName,
  locationName: event.locationName,
  quantity: event.quantity,
  reorderPoint: event.reorderPoint,
});

// Synthetic request context so tenant-scoped repository calls resolve a tenant
// id during a scheduled scan that has no real HTTP request.
const makeScanContext = (tenantId: string): RequestContext => ({
  requestId: uuidv4(),
  path: '/scheduled/low-stock-scan',
  method: 'GET',
  ip: null,
  locale: DEFAULT_LOCALE,
  tenantId,
});

const shouldSendEmail = (
  category: NotificationCategory,
  candidate: AudienceCandidate,
): boolean => effectivePref(category, candidate.emailEnabled ?? undefined);

export class NotificationsService extends Effect.Service<NotificationsService>()(
  '@stocket/effect/notifications/NotificationsService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* NotificationsRepository;
      const trace = makeServiceTracer({
        serviceName: 'NotificationsService',
        module: 'notifications',
        layer: 'service',
      });

      // Sends one email and reconciles the ledger row. Retry wraps only the
      // provider call so a ledger write never triggers a re-send; both outcomes
      // are recorded and the effect itself never fails (scan must not crash).
      const deliverEmail = (
        recipient: Recipient,
        event: NotificationEvent,
        notificationId: string,
      ) =>
        Effect.tryPromise({
          try: () =>
            defaultMailer.send({
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

      // Deliver an event to one recipient over email. Records a
      // pending ledger row first; a null id means the dedupe key was already
      // claimed (prior tick or concurrent instance), so we skip delivery.
      const notify = (recipient: Recipient, event: NotificationEvent) =>
        Effect.gen(function* () {
          const notificationId = yield* repository.recordPending({
            userId: recipient.userId,
            eventKind: event.kind,
            category: eventCategory(event.kind),
            channel: NotificationChannel.EMAIL,
            dedupeKey: buildDedupeKey(event, recipient.userId, currentDay()),
          });
          if (notificationId === null) return;

          yield* deliverEmail(recipient, event, notificationId);
        }).pipe(
          // The only failure reaching here is recordPending; deliverEmail
          // self-reconciles. Log it so a skipped send attempt stays observable.
          Effect.catchAll((cause) =>
            Effect.logError({ messageKey: 'notifications.sendFailed', cause }),
          ),
          trace.span('notify'),
        );

      // One tenant's scan: find low-stock items, resolve the opted-in audience,
      // and notify each (item × recipient). Runs inside a per-tenant context.
      const scanTenant = Effect.gen(function* () {
        const items = yield* repository.findLowStock();
        if (items.length === 0) return;
        const candidates = yield* repository.findAudience(
          NotificationCategory.INVENTORY_ALERTS,
        );
        if (candidates.length === 0) return;

        yield* Effect.forEach(
          items,
          (item) =>
            Effect.forEach(
              candidates,
              (candidate) => {
                if (candidate.email === null) return Effect.void;
                if (
                  !shouldSendEmail(
                    NotificationCategory.INVENTORY_ALERTS,
                    candidate,
                  )
                ) {
                  return Effect.void;
                }
                const recipient: Recipient = {
                  userId: candidate.userId,
                  email: candidate.email,
                  locale: toSupportedLocale(candidate.locale),
                };
                const event: NotificationEvent = {
                  kind: 'low-stock',
                  productId: item.productId,
                  locationId: item.locationId,
                  sku: item.sku,
                  productName: item.productName,
                  locationName: item.locationName,
                  quantity: item.quantity,
                  reorderPoint: item.reorderPoint,
                };
                return notify(recipient, event);
              },
              { discard: true },
            ),
          { discard: true },
        );
      });

      // Scan every tenant. Each tenant gets a fresh synthetic request context so
      // tenant-scoped queries resolve; a failure in one tenant is logged and
      // does not abort the others.
      const runScan = Effect.gen(function* () {
        const tenantIds = yield* repository.listTenantIds();
        yield* Effect.forEach(
          tenantIds,
          (tenantId) =>
            scanTenant.pipe(
              Effect.provideService(
                CurrentRequestContext,
                makeScanContext(tenantId),
              ),
              Effect.catchAll((cause) =>
                Effect.logError({
                  messageKey: 'notifications.sendFailed',
                  cause,
                }),
              ),
            ),
          { discard: true },
        );
      }).pipe(
        trace.span('runScan'),
        Effect.catchAll((cause) =>
          Effect.logError({ messageKey: 'notifications.sendFailed', cause }),
        ),
      );

      // Self-service preference read, shaped into the API response DTO.
      const getPreferences = (userId: string) =>
        repository.findPreferences(userId).pipe(
          Effect.map(
            (rows): NotificationPreferencesResponseDto => ({
              preferences: rows.map((row) => ({
                category: row.category as NotificationCategory,
                channel: row.channel as NotificationChannel,
                enabled: row.enabled,
              })),
            }),
          ),
          trace.span('getPreferences'),
        );

      const updatePreferences = (
        userId: string,
        prefs: ReadonlyArray<PreferenceInput>,
      ) =>
        repository
          .upsertPreferences(userId, prefs)
          .pipe(trace.span('updatePreferences'));

      return {
        notify,
        runScan,
        getPreferences,
        updatePreferences,
        scanInterval: SCAN_INTERVAL,
      };
    }),
    dependencies: [NotificationsRepository.Default],
  },
) {}
