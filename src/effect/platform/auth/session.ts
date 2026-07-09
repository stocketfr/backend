import type { UserSession } from './user-session';

export const getUserIdFromSession = (
  session: UserSession | undefined,
): string | null => {
  return session?.user?.id ?? null;
};

export const getSessionIdFromSession = (
  session: UserSession | undefined,
): string | null => {
  return session?.session?.id ?? null;
};

export const getSessionTimingFromSession = (
  session: UserSession | undefined,
): { issuedAt: number | null; expiresAt: number | null } => {
  if (!session?.session) {
    return { issuedAt: null, expiresAt: null };
  }

  const { createdAt, expiresAt } = session.session;

  const toEpoch = (value: unknown): number | null => {
    if (value instanceof Date) return Math.floor(value.getTime() / 1000);
    if (typeof value === 'string') {
      const ms = Date.parse(value);
      return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
    }
    if (typeof value === 'number') return value;
    return null;
  };

  return {
    issuedAt: toEpoch(createdAt),
    expiresAt: toEpoch(expiresAt),
  };
};
