export const shouldRunBetterAuthMigrations = (isProduction: boolean) =>
  !isProduction || process.env.RUN_BETTER_AUTH_MIGRATIONS === 'true';
