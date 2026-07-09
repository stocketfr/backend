export const toError = (message: string, cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(message, { cause });
