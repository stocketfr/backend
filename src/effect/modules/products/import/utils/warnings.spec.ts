import { makeImportWarning } from './warnings';

describe('makeImportWarning', () => {
  it('builds warning DTOs with defaults and optional fields', () => {
    expect(makeImportWarning('Review import')).toEqual({
      severity: 'warning',
      message: 'Review import',
    });

    expect(
      makeImportWarning('Invalid expiry date', {
        row: 4,
        field: 'expiry_date',
        severity: 'error',
      }),
    ).toEqual({
      row: 4,
      field: 'expiry_date',
      severity: 'error',
      message: 'Invalid expiry date',
    });
  });
});
