import { Effect, Schedule } from 'effect';
import { v4 as uuidv4 } from 'uuid';
import {
  NotificationCategory,
} from '@stocket/types/notifications';
import { defaultMailer } from '../../../email/default-mailer';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { CurrentRequestContext } from '../../platform/http/request-context';
import { NotificationsRepository } from './repository';
import {
  buildScanContext,
  shouldSendEmail,
  toSupportedLocale,
} from './notifications.utils';
import type { NotificationEvent, PreferenceInput, Recipient } from './types';
import { makeNotificationDeliveryWorkflows } from './delivery';
import { toNotificationPreferencesResponse } from './mappers';

const SCAN_INTERVAL = Schedule.spaced('60 seconds');

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

      const delivery = makeNotificationDeliveryWorkflows({
        repository,
        sendEmail: defaultMailer.send,
        now: () => new Date(),
      });

      // Deliver an event to one recipient over email. Records a
      // pending ledger row first; a null id means the dedupe key was already
      // claimed (prior tick or concurrent instance), so we skip delivery.
      const notify = (recipient: Recipient, event: NotificationEvent) =>
        delivery.notify(recipient, event).pipe(trace.span('notify'));

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
                    candidate.emailEnabled,
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
                buildScanContext(tenantId, uuidv4()),
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
          Effect.map(toNotificationPreferencesResponse),
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
