import type { HealthCheckResponse, HealthDetails } from './types';

export const makeHealthResponse = (
  details: Record<string, HealthDetails>,
): HealthCheckResponse => {
  const info = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value.status === 'up'),
  );
  const error = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value.status === 'down'),
  );

  return {
    status: Object.keys(error).length === 0 ? 'ok' : 'error',
    info,
    error,
    details,
  };
};
