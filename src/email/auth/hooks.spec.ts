import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'vitest';
import { createMailer } from '../mailer';
import { createMemoryTransport } from '../transports/memory';
import { makeAuthEmailHooks } from './hooks';

const FRONTEND_ORIGIN = 'http://localhost:3000';
const SIGNUP = {
  email: 'jeanne@stocket.test',
  password: 'super-secret-password',
  name: 'Jeanne',
};

const makeHarness = () => {
  const memory = createMemoryTransport();
  const hooks = makeAuthEmailHooks(
    createMailer({
      transport: memory.transport,
      from: 'Stocket Test <test@stocket.test>',
    }),
  );

  const auth = betterAuth({
    secret: 'test-secret-test-secret-test-secret-42',
    baseURL: 'http://localhost:4000',
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    trustedOrigins: [FRONTEND_ORIGIN],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: hooks.sendResetPassword,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendVerificationEmail: hooks.sendVerificationEmail,
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
    },
  });

  return { auth, sent: memory.sent };
};

type Harness = ReturnType<typeof makeHarness>;

// better-auth forwards `ctx.request` (not bare headers) to the email hooks,
// so locale-sensitive calls pass a Request the way the HTTP handler would.
const requestWith = (locale?: string) =>
  new Request('http://localhost:4000/api/auth/test', {
    headers: locale ? { 'accept-language': locale } : {},
  });

const signUp = async (harness: Harness, locale?: string) =>
  harness.auth.api.signUpEmail({
    body: SIGNUP,
    request: requestWith(locale),
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Hooks detach the actual send from the request, so assertions poll for it.
const waitForSent = async (harness: Harness, count: number) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (harness.sent.length >= count) return;
    await sleep(10);
  }
  throw new Error(
    `Timed out waiting for ${count} sent email(s); got ${harness.sent.length}`,
  );
};

const tokenFrom = (text: string): string => {
  const match = text.match(/[?&]token=([A-Za-z0-9._-]+)/);
  if (!match?.[1]) throw new Error(`No token found in email text:\n${text}`);
  return match[1];
};

describe('better-auth email hooks (memory adapter)', () => {
  it('sends a verification email on sign-up, localized via Accept-Language', async () => {
    const harness = makeHarness();
    await signUp(harness, 'fr-FR,fr;q=0.9');
    await waitForSent(harness, 1);

    const email = harness.sent[0]!;
    expect(email.to).toBe(SIGNUP.email);
    expect(email.subject).toBe('Vérifiez votre adresse e-mail');
    expect(email.text).toContain(
      'http://localhost:4000/api/auth/verify-email?token=',
    );
  });

  it('sends a reset email whose link lands on the frontend with the token attached', async () => {
    const harness = makeHarness();
    await signUp(harness);

    await harness.auth.api.requestPasswordReset({
      body: {
        email: SIGNUP.email,
        redirectTo: `${FRONTEND_ORIGIN}/reset-password`,
      },
    });
    await waitForSent(harness, 2);

    const email = harness.sent.at(-1)!;
    expect(email.subject).toBe('Reset your password');
    expect(email.text).toContain(`${FRONTEND_ORIGIN}/reset-password?token=`);
  });

  it('sends the welcome template when the redirect carries flow=welcome', async () => {
    const harness = makeHarness();
    await signUp(harness, 'fr');

    await harness.auth.api.requestPasswordReset({
      body: {
        email: SIGNUP.email,
        redirectTo: `${FRONTEND_ORIGIN}/reset-password?flow=welcome`,
      },
      request: requestWith('fr'),
    });
    await waitForSent(harness, 2);

    const email = harness.sent.at(-1)!;
    expect(email.subject).toBe(
      'Bienvenue sur Stocket — créez votre mot de passe',
    );
    expect(email.text).toContain('flow=welcome');
    expect(email.text).toContain('token=');
  });

  it('stays enumeration-safe: unknown emails get no message and no error', async () => {
    const harness = makeHarness();
    await signUp(harness);
    await waitForSent(harness, 1);

    await harness.auth.api.requestPasswordReset({
      body: {
        email: 'nobody@stocket.test',
        redirectTo: `${FRONTEND_ORIGIN}/reset-password`,
      },
    });
    await sleep(100);

    expect(harness.sent).toHaveLength(1);
  });

  it('completes the reset flow end-to-end with the emailed token', async () => {
    const harness = makeHarness();
    await signUp(harness);

    await harness.auth.api.requestPasswordReset({
      body: {
        email: SIGNUP.email,
        redirectTo: `${FRONTEND_ORIGIN}/reset-password`,
      },
    });
    await waitForSent(harness, 2);

    const token = tokenFrom(harness.sent.at(-1)!.text);
    const result = await harness.auth.api.resetPassword({
      body: { newPassword: 'an-even-better-password', token },
    });

    expect(result.status).toBe(true);
  });
});
