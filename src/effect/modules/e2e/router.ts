import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { AppConfig } from '../../platform/config/app-config';
import { ForbiddenError, InternalError } from '../../platform/effect/domain-errors';
import { respondJson } from '../../platform/http/errors';
import { seedE2eTenant } from '../../../scripts/seed-e2e';

class E2eSeedDisabled extends ForbiddenError('E2eSeedDisabled') {}
class E2eSeedFailed extends InternalError('E2eSeedFailed')<{
  readonly cause: unknown;
}> {}

const SeedE2eRequestSchema = Schema.Struct({
  userEmail: Schema.optional(Schema.String),
});

const getHeader = (
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined => {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
};

const requireE2eSeedEnabled = Effect.gen(function* () {
  const appConfig = yield* AppConfig;

  if (appConfig.isProduction) {
    return yield* Effect.fail(
      new E2eSeedDisabled({ messageKey: 'e2e.seedDisabled' }),
    );
  }

  const secret = appConfig.e2eSeedSecret;
  if (!secret) {
    // Fail closed: a missing secret must not leave the seed endpoint open on
    // shared environments such as staging.
    if (!appConfig.isDevelopment) {
      return yield* Effect.fail(
        new E2eSeedDisabled({ messageKey: 'e2e.seedDisabled' }),
      );
    }
    return;
  }

  const request = yield* HttpServerRequest.HttpServerRequest;
  if (getHeader(request, 'x-e2e-seed-secret') === secret) {
    return;
  }

  return yield* Effect.fail(
    new E2eSeedDisabled({ messageKey: 'e2e.seedDisabled' }),
  );
});

export const e2eRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/seed',
    Effect.gen(function* () {
      yield* requireE2eSeedEnabled;
      const dto = yield* HttpServerRequest.schemaBodyJson(SeedE2eRequestSchema);

      return yield* respondJson(
        Effect.tryPromise({
          try: () => seedE2eTenant({ userEmail: dto.userEmail }),
          catch: (cause) =>
            new E2eSeedFailed({
              messageKey: 'e2e.seedFailed',
              cause,
            }),
        }).pipe(
          Effect.map((result) => ({
            seeded: true,
            ...result,
          })),
        ),
        { status: 201 },
      );
    }),
  ),
  HttpRouter.prefixAll('/e2e'),
);
