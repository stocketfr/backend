import { HttpApiBuilder } from '@effect/platform';
import { Effect } from 'effect';
import { AppApi } from '../../http/api';
import { ServiceDown } from './api';
import { HealthService, type HealthCheckResponse } from './service';

/**
 * HttpApiBuilder implementation for the health group.
 *
 * Each handler returns a self-contained Effect — no external service requirements
 * leak out because HealthService closes over DrizzleDatabase and BetterAuth
 * at layer-build time (effect: pattern in the service).
 *
 * When the health check returns status 'error', the handler fails with
 * ServiceDown (annotated with HTTP 503). HttpApiBuilder encodes the correct
 * status code from that annotation automatically.
 */
export const HealthApiLive = HttpApiBuilder.group(
  AppApi,
  'health',
  (handlers) =>
    Effect.gen(function* () {
      const svc = yield* HealthService;

      const toServiceDown = (response: HealthCheckResponse) =>
        new ServiceDown({ details: response.details });

      return handlers
        .handle('live', () => svc.live)
        .handle('ready', () =>
          svc.ready.pipe(
            Effect.flatMap((response) =>
              response.status === 'ok'
                ? Effect.succeed(response)
                : Effect.fail(toServiceDown(response)),
            ),
          ),
        )
        .handle('check', () =>
          svc.healthCheck.pipe(
            Effect.flatMap((response) =>
              response.status === 'ok'
                ? Effect.succeed(response)
                : Effect.fail(toServiceDown(response)),
            ),
          ),
        );
    }),
);
