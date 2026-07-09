import { HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';
import {
  AppConfig,
  type AppConfigShape,
} from '../../platform/config/app-config';
import { E2eSeedDisabled } from './e2e.errors';

type E2eSeedAccessConfig = Pick<
  AppConfigShape,
  'e2eSeedSecret' | 'isDevelopment' | 'isProduction'
>;

const getHeader = (
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined => {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
};

export const isE2eSeedAllowed = (
  appConfig: E2eSeedAccessConfig,
  providedSecret: string | undefined,
): boolean => {
  if (appConfig.isProduction) return false;

  const secret = appConfig.e2eSeedSecret;
  if (!secret) return appConfig.isDevelopment;

  return providedSecret === secret;
};

export const requireE2eSeedEnabled = Effect.gen(function* () {
  const appConfig = yield* AppConfig;

  if (!appConfig.e2eSeedSecret) {
    if (isE2eSeedAllowed(appConfig, undefined)) return;

    return yield* Effect.fail(
      new E2eSeedDisabled({ messageKey: 'e2e.seedDisabled' }),
    );
  }

  const request = yield* HttpServerRequest.HttpServerRequest;
  if (isE2eSeedAllowed(appConfig, getHeader(request, 'x-e2e-seed-secret'))) {
    return;
  }

  return yield* Effect.fail(
    new E2eSeedDisabled({ messageKey: 'e2e.seedDisabled' }),
  );
});
