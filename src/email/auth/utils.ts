import {
  RESET_PASSWORD_PATH,
  WELCOME_FLOW_PARAM,
  WELCOME_FLOW_VALUE,
} from '@stocket/types/auth';
import { firstFrontendOrigin, tryParseUrl } from '../../config/frontend-url.utils';
import type { AuthEmailUser } from './types';

// better-auth's reset URL points at its own GET /reset-password/:token redirect
// endpoint with the destination in ?callbackURL. Link the email straight to the
// destination with the token attached instead of routing through the redirect.
export const buildResetActionUrl = (url: string, token: string): URL => {
  const callbackParam = tryParseUrl(url)?.searchParams.get('callbackURL');
  const action =
    (callbackParam ? tryParseUrl(callbackParam, firstFrontendOrigin()) : null) ??
    new URL(RESET_PASSWORD_PATH, firstFrontendOrigin());
  action.searchParams.set('token', token);
  return action;
};

export const displayName = (user: AuthEmailUser): string =>
  user.name.trim() || user.email;

export const isWelcomeActionUrl = (url: URL): boolean =>
  url.searchParams.get(WELCOME_FLOW_PARAM) === WELCOME_FLOW_VALUE;

// better-auth awaits these hooks inside its request handler, so the send is
// detached: rendering plus the provider round-trip must not delay sign-up or
// password-reset responses. Hooks must never throw because a failure would 500
// the auth request, and they run outside the Effect runtime.
export const detachSend = (send: Promise<unknown>, what: string): void => {
  void send.catch((error) =>
    console.error(`[email] failed to send ${what}`, error),
  );
};
