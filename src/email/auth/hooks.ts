import { resolveLocale } from '../../effect/platform/observability/messages';
import type { Mailer } from '../mailer';
import type { AuthEmailData } from './types';
import {
  buildResetActionUrl,
  detachSend,
  displayName,
  isWelcomeActionUrl,
} from './utils';

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
      detachSend(
        mailer.send({
          to: data.user.email,
          locale: resolveLocale(request?.headers.get('accept-language')),
          template: {
            kind: isWelcomeActionUrl(action)
              ? 'welcome-set-password'
              : 'reset-password',
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
