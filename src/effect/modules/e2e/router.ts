import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { respondJson } from '../../platform/http/errors';
import { seedE2eTenant } from '../../../scripts/seed-e2e';
import { requireE2eSeedEnabled } from './access';
import { E2eSeedFailed } from './e2e.errors';

const SeedE2eRequestSchema = Schema.Struct({
  userEmail: Schema.optional(Schema.String),
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
