import {
  RESET_PASSWORD_PATH,
  WELCOME_FLOW_PARAM,
  WELCOME_FLOW_VALUE,
} from '@stocket/types/auth';
import { firstFrontendOrigin, tryParseUrl } from '../config/frontend-url.utils';
import { resolveLocale } from '../effect/platform/observability/messages';
import type { Mailer } from './mailer';

interface AuthEmailUser {
  readonly email: string;
  readonly name: string;
}

interface AuthEmailData {
  readonly user: AuthEmailUser;
  readonly url: string;
  readonly token: string;
}

// better-auth's reset URL points at its own GET /reset-password/:token redirect
// endpoint with the destination in ?callbackURL. Link the email straight to the
// destination with the token attached instead of routing through the redirect.
const buildResetActionUrl = (url: string, token: string): URL => {
  const callbackParam = tryParseUrl(url)?.searchParams.get('callbackURL');
  const action =
    (callbackParam ? tryParseUrl(callbackParam, firstFrontendOrigin()) : null) ??
    new URL(RESET_PASSWORD_PATH, firstFrontendOrigin());
  action.searchParams.set('token', token);
  return action;
};

const displayName = (user: AuthEmailUser): string =>
  user.name.trim() || user.email;

// better-auth awaits these hooks inside its request handler, so the send is
// detached: rendering plus the provider round-trip must not delay sign-up or
// password-reset responses (which also keeps response timing uniform whether
// or not an account exists). Hooks must never throw — a failure would 500 the
// request — and they run outside the Effect runtime, so plain console logging
// is the only channel available.
const detachSend = (send: Promise<unknown>, what: string): void => {
  void send.catch((error) =>
    console.error(`[email] failed to send ${what}`, error),
  );
};

export const makeAuthEmailHooks = (mailer: Mailer) => ({
  sendVerificationEmail: async (
    data: AuthEmailData,
    request?: Request,
  ): Promise<void> => {
    try {
      detachSend(
        mailer.send({
          to: data.user.email,
          locale: resolveLocale(request?.headers.get('accept-language')),
          template: {
            kind: 'verify-email',
            userName: displayName(data.user),
            actionUrl: data.url,
          },
        }),
        'verification email',
      );
    } catch (error) {
      console.error('[email] failed to send verification email', error);
    }
  },

  sendResetPassword: async (
    data: AuthEmailData,
    request?: Request,
  ): Promise<void> => {
    try {
      const action = buildResetActionUrl(data.url, data.token);
      const isWelcome =
        action.searchParams.get(WELCOME_FLOW_PARAM) === WELCOME_FLOW_VALUE;
      detachSend(
        mailer.send({
          to: data.user.email,
          locale: resolveLocale(request?.headers.get('accept-language')),
          template: {
            kind: isWelcome ? 'welcome-set-password' : 'reset-password',
            userName: displayName(data.user),
            actionUrl: action.toString(),
          },
        }),
        'password reset email',
      );
    } catch (error) {
      console.error('[email] failed to send password reset email', error);
    }
  },
});
