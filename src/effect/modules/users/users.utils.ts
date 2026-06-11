import {
  RESET_PASSWORD_PATH,
  WELCOME_FLOW_PARAM,
  WELCOME_FLOW_VALUE,
} from '@stocket/types/auth';
import {
  firstFrontendOrigin,
  tryParseUrl,
} from '../../../config/frontend-url.utils';

/**
 * Destination for the set-password link in the welcome email. The `flow`
 * marker is what `sendResetPassword` uses to pick the welcome template over
 * the reset one, and it must survive better-auth's `originCheck` — hence an
 * absolute URL on the requesting origin (or the configured frontend).
 */
export const welcomeRedirectUrl = (requestOrigin: string | null): string => {
  const base =
    (requestOrigin ? tryParseUrl(RESET_PASSWORD_PATH, requestOrigin) : null) ??
    new URL(RESET_PASSWORD_PATH, firstFrontendOrigin());
  base.searchParams.set(WELCOME_FLOW_PARAM, WELCOME_FLOW_VALUE);
  return base.toString();
};
