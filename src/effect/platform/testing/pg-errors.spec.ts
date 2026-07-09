import { describe, expect, it } from 'vitest';
import { pgUniqueViolationConstraintName } from '../db/pg-errors';

describe('pgUniqueViolationConstraintName', () => {
  it('returns the constraint name from a pg unique violation', () => {
    expect(
      pgUniqueViolationConstraintName({
        code: '23505',
        constraint: 'products_tenant_sku_unique',
      }),
    ).toBe('products_tenant_sku_unique');
  });

  it('walks one wrapped cause', () => {
    expect(
      pgUniqueViolationConstraintName({
        cause: {
          code: '23505',
          constraint: 'organization_slug_unique',
        },
      }),
    ).toBe('organization_slug_unique');
  });

  it('does not recursively search deeply nested causes', () => {
    expect(
      pgUniqueViolationConstraintName({
        cause: {
          cause: {
            code: '23505',
            constraint: 'organization_slug_unique',
          },
        },
      }),
    ).toBeNull();
  });
});
