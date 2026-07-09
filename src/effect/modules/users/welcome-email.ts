import { Effect } from 'effect';
import { BetterAuthHeaders } from '../../platform/auth/better-auth';
import { type LogPayload } from '../../platform/observability/messages';
import { welcomeRedirectUrl } from './users.utils';

export interface WelcomeEmailPasswordResetRequest {
  readonly body: {
    readonly email: string;
    readonly redirectTo: string;
  };
  readonly headers: Headers;
  readonly request: Request;
}

export interface RequestWelcomeEmailOptions {
  readonly email: string;
  readonly requestPasswordReset: (
    request: WelcomeEmailPasswordResetRequest,
  ) => Promise<unknown>;
}

// Welcome emails reuse the password-reset machinery: the `flow=welcome`
// marker in `redirectTo` is what flips the template. Failures only log —
// user creation must never roll back because an email could not be sent.
export const requestWelcomeEmail = ({
  email,
  requestPasswordReset,
}: RequestWelcomeEmailOptions) =>
  Effect.gen(function* () {
    const headers = yield* BetterAuthHeaders;
    const redirectTo = welcomeRedirectUrl(headers.get('origin'));
    yield* Effect.tryPromise(() =>
      requestPasswordReset({
        body: { email, redirectTo },
        headers,
        // better-auth only forwards ctx.request to the sendResetPassword
        // hook; without it the email loses the Accept-Language locale.
        request: new Request(redirectTo, { headers }),
      }),
    );
  }).pipe(
    Effect.catchAll((cause) =>
      Effect.logError({
        messageKey: 'email.welcomeRequestFailed',
        to: email,
        cause,
      } satisfies LogPayload),
    ),
  );
