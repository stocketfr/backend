import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstFrontendOrigin, frontendOrigins } from './frontend-url.utils';

describe('frontend URL config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads one or more configured frontend origins', () => {
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000, https://app.stocket.fr');

    expect(frontendOrigins()).toEqual([
      'http://localhost:3000',
      'https://app.stocket.fr',
    ]);
    expect(firstFrontendOrigin()).toBe('http://localhost:3000');
  });

  it('requires FRONTEND_URL', () => {
    vi.stubEnv('FRONTEND_URL', '');

    expect(() => frontendOrigins()).toThrow(
      'FRONTEND_URL environment variable is required',
    );
  });

  it('rejects empty origin lists', () => {
    vi.stubEnv('FRONTEND_URL', ',,');

    expect(() => frontendOrigins()).toThrow(
      'FRONTEND_URL must contain at least one origin',
    );
  });
});
