import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { BetterAuthHeaders } from '../../platform/auth/better-auth';
import {
  requestWelcomeEmail,
  type WelcomeEmailPasswordResetRequest,
} from './welcome-email';

const headers = new Headers({ origin: 'https://app.stocket.test' });

const withHeaders = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(BetterAuthHeaders, headers));

describe('requestWelcomeEmail', () => {
  it.effect('requests a password reset with the welcome redirect', () =>
    Effect.gen(function* () {
      const calls: WelcomeEmailPasswordResetRequest[] = [];

      yield* withHeaders(
        requestWelcomeEmail({
          email: 'new-user@example.com',
          requestPasswordReset: (request) => {
            calls.push(request);
            return Promise.resolve({ status: true });
          },
        }),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        body: {
          email: 'new-user@example.com',
          redirectTo:
            'https://app.stocket.test/reset-password?flow=welcome',
        },
        headers,
      });
      expect(calls[0]?.request.url).toBe(
        'https://app.stocket.test/reset-password?flow=welcome',
      );
    }),
  );

  it.effect('logs and succeeds when the welcome request fails', () =>
    withHeaders(
      requestWelcomeEmail({
        email: 'new-user@example.com',
        requestPasswordReset: () => Promise.reject(new Error('resend failed')),
      }),
    ),
  );
});
