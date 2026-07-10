export const APPLICATION_NODE_ENVS = [
  'development',
  'staging',
  'production',
] as const;

export type ApplicationNodeEnv = (typeof APPLICATION_NODE_ENVS)[number];

const applicationNodeEnvSet: ReadonlySet<string> = new Set(
  APPLICATION_NODE_ENVS,
);

export const isApplicationNodeEnv = (
  value: string,
): value is ApplicationNodeEnv => applicationNodeEnvSet.has(value);

export const parseApplicationPort = (value: string): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
};
