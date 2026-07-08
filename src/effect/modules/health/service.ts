import { Effect } from 'effect';
import { sql } from 'drizzle-orm';
import { BetterAuth } from '../../platform/auth/better-auth';
import { AppConfig } from '../../platform/config/app-config';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { type AnyMessageKey, type MessageArgs } from '../../platform/observability/messages';
import { makeServiceTracer } from '../../platform/observability/service-tracer';

interface HealthDetails {
  readonly status: 'up' | 'down';
  readonly message?: string;
  readonly messageKey?: AnyMessageKey;
  readonly messageArgs?: MessageArgs;
}

export interface HealthCheckResponse {
  readonly status: 'ok' | 'error';
  readonly info: Record<string, HealthDetails>;
  readonly error: Record<string, HealthDetails>;
  readonly details: Record<string, HealthDetails>;
}

const makeHealthResponse = (
  details: Record<string, HealthDetails>,
): HealthCheckResponse => {
  const info = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value.status === 'up'),
  );
  const error = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value.status === 'down'),
  );

  return {
    status: Object.keys(error).length === 0 ? 'ok' : 'error',
    info,
    error,
    details,
  };
};

export class HealthService extends Effect.Service<HealthService>()(
  '@stocket/effect/health/HealthService',
  {
    effect: Effect.gen(function* () {
      // Acquire the platform services once at layer-build time and close over them.
      // This makes the public methods self-contained Effects with no external requirements,
      // which is required for HttpApiBuilder handler compatibility.
      const db = yield* DrizzleDatabase;
      const auth = yield* BetterAuth;
      const appConfig = yield* AppConfig;
      const trace = makeServiceTracer({
        serviceName: 'HealthService',
        module: 'health',
        layer: 'service',
      });

      const checkDatabase = Effect.tryPromise({
        try: async () => {
          await db.execute(sql`SELECT 1`);
          return { status: 'up' as const };
        },
        catch: () => ({
          status: 'down' as const,
          messageKey: 'health.databaseUnreachable' as AnyMessageKey,
        }),
      });

      const checkBetterAuth = Effect.sync(() => {
        if (!appConfig.hasBetterAuthSecret) {
          return {
            status: 'down' as const,
            messageKey: 'health.betterAuthSecretMissing' as AnyMessageKey,
          };
        }
        return {
          status: 'up' as const,
          messageKey: 'health.betterAuthConfigured' as AnyMessageKey,
        };
      });

      // Verify the auth reference is used (satisfies yield dependency)
      void auth;

      const live = Effect.succeed(makeHealthResponse({})).pipe(trace.span('live'));

      const ready = Effect.merge(checkDatabase).pipe(
        Effect.map((database) => makeHealthResponse({ database })),
        trace.span('ready'),
      );

      const healthCheck = Effect.all({
        database: Effect.merge(checkDatabase),
        'better-auth': Effect.merge(checkBetterAuth),
      }).pipe(
        Effect.map(makeHealthResponse),
        trace.span('healthCheck'),
      );

      return { live, ready, healthCheck };
    }),
    // DrizzleDatabase and BetterAuth are platform services wired externally in main.ts
    // via platformLayer; they are NOT listed here to avoid creating duplicate connections.
    dependencies: [AppConfig.Default],
  },
) {}
