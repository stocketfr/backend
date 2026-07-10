import { describe, expect, it } from 'vitest';

import { formatLogLine } from './console-logging';

const requestLog = {
  messageKey: 'http.request',
  requestId: '11111111-2222-3333-4444-555555555555',
  tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  method: 'GET',
  path: '/api/v1/inventory',
  statusCode: 200,
  durationMs: 17,
  userAgent: 'node',
};

describe('formatLogLine', () => {
  it('keeps the compact text format for local logs', () => {
    expect(
      formatLogLine(
        {
          date: new Date('2026-07-10T10:20:30.456Z'),
          level: 'INFO',
          message: requestLog,
        },
        'text',
      ),
    ).toContain(
      'INFO http.request GET /api/v1/inventory 200 17ms rid=11111111',
    );
  });

  it('emits Datadog-friendly JSON with typed request fields', () => {
    const line = formatLogLine(
      {
        date: new Date('2026-07-10T10:20:30.456Z'),
        level: 'INFO',
        message: requestLog,
      },
      'json',
    );

    expect(JSON.parse(line)).toEqual({
      ...requestLog,
      timestamp: '2026-07-10T10:20:30.456Z',
      status: 'info',
      message:
        'http.request GET /api/v1/inventory 200 17ms rid=11111111 tid=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee ua=node',
    });
  });

  it('serializes errors without dropping their name and message', () => {
    const line = formatLogLine(
      {
        date: new Date('2026-07-10T10:20:30.456Z'),
        level: 'ERROR',
        message: {
          messageKey: 'http.serverError',
          statusCode: 500,
          path: '/api/v1/inventory',
          error: new TypeError('database unavailable'),
        },
      },
      'json',
    );

    expect(JSON.parse(line)).toMatchObject({
      status: 'error',
      messageKey: 'http.serverError',
      error: {
        kind: 'TypeError',
        message: 'database unavailable',
      },
    });
  });
});
