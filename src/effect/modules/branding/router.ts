import { HttpRouter } from '@effect/platform';
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { UpdateBrandingSchema } from '@stocket/types/branding';
import {
  emptyInput,
  jsonBody,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { BrandingUnauthorized } from './branding.errors';
import { BrandingService } from './service';

export const brandingRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      decode: emptyInput,
      handler: () =>
        Effect.flatMap(BrandingService, (brandingService) =>
          brandingService.get(),
        ),
    }),
  ),
  HttpRouter.put(
    '/',
    tenantRoute({
      permissions: [[Resource.SETTINGS, Permission.WRITE]],
      decode: jsonBody(UpdateBrandingSchema),
      session: 'required',
      handler: ({ input: dto, session }) =>
        Effect.gen(function* () {
          if (!session) {
            return yield* Effect.fail(
              new BrandingUnauthorized({
                messageKey: 'branding.sessionUserUnavailable',
              }),
            );
          }

          const brandingService = yield* BrandingService;
          return yield* brandingService.update(dto, session.user.id);
        }),
    }),
  ),
  HttpRouter.prefixAll('/branding'),
);
