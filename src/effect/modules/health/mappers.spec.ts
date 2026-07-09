import { describe, expect, it } from '@effect/vitest';
import { makeHealthResponse } from './mappers';

describe('makeHealthResponse', () => {
  it('partitions up and down checks and marks the response ok when none failed', () => {
    expect(
      makeHealthResponse({
        database: { status: 'up' },
        'better-auth': {
          status: 'up',
          messageKey: 'health.betterAuthConfigured',
        },
      }),
    ).toEqual({
      status: 'ok',
      info: {
        database: { status: 'up' },
        'better-auth': {
          status: 'up',
          messageKey: 'health.betterAuthConfigured',
        },
      },
      error: {},
      details: {
        database: { status: 'up' },
        'better-auth': {
          status: 'up',
          messageKey: 'health.betterAuthConfigured',
        },
      },
    });
  });

  it('includes failed checks in error and marks the response as error', () => {
    expect(
      makeHealthResponse({
        database: {
          status: 'down',
          messageKey: 'health.databaseUnreachable',
        },
        'better-auth': { status: 'up' },
      }),
    ).toEqual({
      status: 'error',
      info: {
        'better-auth': { status: 'up' },
      },
      error: {
        database: {
          status: 'down',
          messageKey: 'health.databaseUnreachable',
        },
      },
      details: {
        database: {
          status: 'down',
          messageKey: 'health.databaseUnreachable',
        },
        'better-auth': { status: 'up' },
      },
    });
  });
});
