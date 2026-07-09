import { Effect } from 'effect';
import { parseAndDetectProductImportFormat } from './parser';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const fail = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

describe('parseAndDetectProductImportFormat', () => {
  it('parses normalized product CSV content and detects its format', async () => {
    const result = await run(
      parseAndDetectProductImportFormat({
        content: 'sku,name,category_path\nSKU-1,Spa Oil,Spa\n',
      }),
    );

    expect(result.format).toBe('normalized-products');
    expect(result.parsed.headers).toEqual(['sku', 'name', 'category_path']);
    expect(result.parsed.records).toHaveLength(1);
  });

  it('fails when headers do not match a supported import format', async () => {
    const error = await fail(
      parseAndDetectProductImportFormat({
        content: 'unknown,name\n1,Spa Oil\n',
      }),
    );

    expect(error._tag).toBe('ProductImportUnsupportedFormat');
  });

  it('maps CSV parser failures to the product import parse error', async () => {
    const error = await fail(
      parseAndDetectProductImportFormat({
        content: 'sku,name,category_path\n"SKU-1,Spa Oil,Spa\n',
      }),
    );

    expect(error._tag).toBe('ProductImportCsvParseFailed');
  });
});
