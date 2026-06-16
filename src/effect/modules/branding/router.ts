import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { UpdateBrandingSchema } from '@stocket/types/branding';
import { requirePermission } from '../../platform/auth/authorization';
import { respondJson } from '../../platform/http/errors';
import { requireSession } from '../../platform/http/session';
import { BrandingUnauthorized } from './branding.errors';
import { BrandingService } from './service';

export const brandingRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      const brandingService = yield* BrandingService;
      return yield* respondJson(brandingService.get());
    }),
  ),
  HttpRouter.put(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.SETTINGS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(UpdateBrandingSchema);
      const session = yield* requireSession;
      const userId = session.user.id;

      if (!userId) {
        return yield* respondJson(
          Effect.fail(
            new BrandingUnauthorized({
              messageKey: 'branding.sessionUserUnavailable',
            }),
          ),
        );
      }

      const brandingService = yield* BrandingService;
      return yield* respondJson(brandingService.update(dto, userId));
    }),
  ),
  HttpRouter.prefixAll('/branding'),
);
