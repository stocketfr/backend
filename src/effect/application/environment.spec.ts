import { describe, expect, it } from 'vitest';
import { parseApplicationPort } from './environment';

describe('parseApplicationPort', () => {
  it.each([
    ['1', 1],
    ['8080', 8080],
    ['65535', 65_535],
  ] as const)('parses valid TCP port %s', (value, expected) => {
    expect(parseApplicationPort(value)).toBe(expected);
  });

  it.each(['0', '-1', '1.5', '65536', 'not-a-number'])(
    'rejects invalid TCP port %s',
    (value) => {
      expect(() => parseApplicationPort(value)).toThrow(
        'PORT must be an integer between 1 and 65535',
      );
    },
  );
});
