import { Config, Effect, Option } from 'effect';

export type NodeEnv = 'development' | 'staging' | 'production' | 'test';

export interface AppConfigShape {
  readonly nodeEnv: NodeEnv;
  readonly isProduction: boolean;
  readonly isStaging: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
  readonly isVitest: boolean;
  readonly isTestLike: boolean;
  readonly isDevLike: boolean;
  readonly hasBetterAuthSecret: boolean;
  readonly e2eSeedSecret: string | null;
  readonly corsOrigins: readonly string[];
}

const nodeEnvConfig = Config.literal(
  'development',
  'staging',
  'production',
  'test',
)('NODE_ENV').pipe(Config.withDefault('development' as const));

const parseCommaSeparatedList = (value: string): readonly string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const appConfig = Config.all({
  nodeEnv: nodeEnvConfig,
  betterAuthSecret: Config.option(Config.nonEmptyString('BETTER_AUTH_SECRET')),
  e2eSeedSecret: Config.option(Config.nonEmptyString('E2E_SEED_SECRET')),
  isVitest: Config.boolean('VITEST').pipe(Config.withDefault(false)),
  corsOrigins: Config.string('CORS_ORIGIN').pipe(
    Config.withDefault(''),
    Config.map(parseCommaSeparatedList),
  ),
}).pipe(
  Config.map(
    ({
      nodeEnv,
      betterAuthSecret,
      e2eSeedSecret,
      isVitest,
      corsOrigins,
    }): AppConfigShape => ({
      nodeEnv,
      isProduction: nodeEnv === 'production',
      isStaging: nodeEnv === 'staging',
      isDevelopment: nodeEnv === 'development',
      isTest: nodeEnv === 'test',
      isVitest,
      isTestLike: nodeEnv === 'test' || isVitest,
      isDevLike: nodeEnv !== 'production' && nodeEnv !== 'staging',
      hasBetterAuthSecret: Option.isSome(betterAuthSecret),
      e2eSeedSecret: Option.getOrNull(e2eSeedSecret),
      corsOrigins,
    }),
  ),
);

export class AppConfig extends Effect.Service<AppConfig>()(
  '@stocket/effect/platform/AppConfig',
  {
    effect: appConfig.pipe(Effect.orDie),
  },
) {}
