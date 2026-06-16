import { HttpRouter } from '@effect/platform';
import { Effect } from 'effect';
import { respondJson } from '../../platform/http/errors';
import { AuthService } from './service';

export const authRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/auth/me',
    Effect.gen(function* () {
      const authService = yield* AuthService;
      return yield* respondJson(authService.me());
    }),
  ),
  HttpRouter.get(
    '/auth/profile',
    Effect.gen(function* () {
      const authService = yield* AuthService;
      return yield* respondJson(authService.profile());
    }),
  ),
  HttpRouter.get(
    '/auth/session-claims',
    Effect.gen(function* () {
      const authService = yield* AuthService;
      return yield* respondJson(authService.sessionClaims());
    }),
  ),
);
