import { HttpRouter } from '@effect/platform';
import { Effect } from 'effect';
import { UpdateNotificationPreferencesSchema } from '@stocket/types/notifications';
import {
  emptyInput,
  jsonBody,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { makeMessageResponse } from '../../platform/observability/messages';
import { NotificationsService } from './service';

// Self-service: every handler is scoped to the authenticated user via
// session.user.id, so there is no RBAC resource gate and no audit write.
export const notificationsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/preferences',
    tenantRoute({
      decode: emptyInput,
      session: 'required',
      handler: ({ session }) =>
        session
          ? Effect.gen(function* () {
              yield* Effect.annotateCurrentSpan({ userId: session.user.id });
              const notifications = yield* NotificationsService;
              return yield* notifications.getPreferences(session.user.id);
            })
          : Effect.dieMessage(
              'Required session missing for notification preferences',
            ),
    }),
  ),
  HttpRouter.put(
    '/preferences',
    tenantRoute({
      decode: jsonBody(UpdateNotificationPreferencesSchema),
      session: 'required',
      handler: ({ input: dto, session }) =>
        session
          ? Effect.gen(function* () {
              yield* Effect.annotateCurrentSpan({ userId: session.user.id });
              const notifications = yield* NotificationsService;
              yield* notifications.updatePreferences(
                session.user.id,
                dto.preferences,
              );
              return makeMessageResponse('notifications.preferencesUpdated');
            })
          : Effect.dieMessage(
              'Required session missing for notification preferences',
            ),
    }),
  ),
  HttpRouter.prefixAll('/notifications'),
);
