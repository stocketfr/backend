import { localizeMessageTree } from '../observability/messages';

describe('localizeMessageTree', () => {
  it('preserves Date objects so JSON responses serialize them as ISO strings', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    const result = localizeMessageTree(
      { data: [{ id: 'log-1', created_at: createdAt }] },
      'en',
    );

    expect(result).toEqual({ data: [{ id: 'log-1', created_at: createdAt }] });
    expect(JSON.stringify(result)).toContain(
      '"created_at":"2026-01-01T00:00:00.000Z"',
    );
  });
});
