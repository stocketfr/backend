import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';
import { UpdateNotificationPreferencesSchema } from '@stocket/types/notifications';
import { requireSession } from '../../platform/session';
import { respondJson } from '../../platform/errors';
import { makeMessageResponse } from '../../platform/messages';
import { NotificationsService } from './service';

// Self-service: every handler is scoped to the authenticated user via
// session.user.id, so there is no RBAC resource gate and no audit write.
export const notificationsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/preferences',
    Effect.gen(function* () {
      const session = yield* requireSession;
      yield* Effect.annotateCurrentSpan({ userId: session.user.id });
      const notifications = yield* NotificationsService;
      return yield* respondJson(notifications.getPreferences(session.user.id));
    }),
  ),
  HttpRouter.put(
    '/preferences',
    Effect.gen(function* () {
      const session = yield* requireSession;
      yield* Effect.annotateCurrentSpan({ userId: session.user.id });
      const dto = yield* HttpServerRequest.schemaBodyJson(
        UpdateNotificationPreferencesSchema,
      );
      const notifications = yield* NotificationsService;
      yield* notifications.updatePreferences(session.user.id, dto.preferences);
      return yield* respondJson(
        Effect.succeed(makeMessageResponse('notifications.preferencesUpdated')),
      );
    }),
  ),
  HttpRouter.prefixAll('/notifications'),
);
