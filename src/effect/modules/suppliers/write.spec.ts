import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  makeSupplierWriteWorkflows,
  type SupplierWriteRepository,
} from './write';
import type { SupplierEntity } from './types';

const tenantId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-03-01T00:00:00.000Z');

const makeSupplier = (
  overrides: Partial<SupplierEntity> = {},
): SupplierEntity => ({
  id: 'supplier-1',
  tenant_id: tenantId,
  name: 'Best Supplies',
  contact_person: null,
  email: null,
  phone: null,
  address: null,
  website: null,
  notes: null,
  is_active: true,
  created_at: now,
  updated_at: now,
  ...overrides,
});

type SupplierCreateData = Parameters<SupplierWriteRepository['create']>[0];
type SupplierUpdateData = Parameters<SupplierWriteRepository['update']>[1];

const makeRepository = (
  overrides: Partial<SupplierWriteRepository> = {},
): SupplierWriteRepository => ({
  create: (values) =>
    Effect.succeed(
      makeSupplier({
        ...values,
      }),
    ),
  update: (_id, values) =>
    Effect.succeed(
      makeSupplier({
        ...values,
      }),
    ),
  ...overrides,
});

describe('makeSupplierWriteWorkflows', () => {
  it.effect('creates a supplier from normalized create values', () =>
    Effect.gen(function* () {
      let capturedCreate: SupplierCreateData | undefined;
      const repository = makeRepository({
        create: (values) =>
          Effect.sync(() => {
            capturedCreate = values;
            return makeSupplier({ id: 'supplier-new', ...values });
          }),
      });
      const workflows = makeSupplierWriteWorkflows({
        repository,
        getSupplierOrFail: () => Effect.succeed(makeSupplier()),
      });

      const result = yield* workflows.create({
        name: 'Fresh Supplies',
        email: 'fresh@supplier.test',
      });

      expect(capturedCreate).toEqual({
        name: 'Fresh Supplies',
        contact_person: null,
        email: 'fresh@supplier.test',
        phone: null,
        address: null,
        website: null,
        notes: null,
        is_active: true,
      });
      expect(result).toMatchObject({
        id: 'supplier-new',
        name: 'Fresh Supplies',
        email: 'fresh@supplier.test',
      });
    }),
  );

  it.effect('returns the current supplier without writing an empty update', () =>
    Effect.gen(function* () {
      let updateCalled = false;
      const existing = makeSupplier({ name: 'Existing Supplies' });
      const repository = makeRepository({
        update: () =>
          Effect.sync(() => {
            updateCalled = true;
            return makeSupplier();
          }),
      });
      const workflows = makeSupplierWriteWorkflows({
        repository,
        getSupplierOrFail: () => Effect.succeed(existing),
      });

      const result = yield* workflows.update('supplier-1', {});

      expect(result.name).toBe('Existing Supplies');
      expect(updateCalled).toBe(false);
    }),
  );

  it.effect('updates changed supplier fields', () =>
    Effect.gen(function* () {
      let capturedUpdate:
        | {
            readonly id: string;
            readonly values: SupplierUpdateData;
          }
        | undefined;
      const repository = makeRepository({
        update: (id, values) =>
          Effect.sync(() => {
            capturedUpdate = { id, values };
            return makeSupplier({
              id,
              name: values.name ?? 'Best Supplies',
              is_active: values.is_active ?? true,
            });
          }),
      });
      const workflows = makeSupplierWriteWorkflows({
        repository,
        getSupplierOrFail: () => Effect.succeed(makeSupplier()),
      });

      const result = yield* workflows.update('supplier-1', {
        name: 'Updated Supplies',
        is_active: false,
      });

      expect(capturedUpdate).toEqual({
        id: 'supplier-1',
        values: {
          name: 'Updated Supplies',
          is_active: false,
        },
      });
      expect(result).toMatchObject({
        id: 'supplier-1',
        name: 'Updated Supplies',
        is_active: false,
      });
    }),
  );

  it.effect('fails with SupplierNotFound when an update races a delete', () =>
    Effect.gen(function* () {
      const workflows = makeSupplierWriteWorkflows({
        repository: makeRepository({
          update: () => Effect.succeed(null),
        }),
        getSupplierOrFail: () => Effect.succeed(makeSupplier()),
      });

      const error = yield* Effect.flip(
        workflows.update('missing-supplier', { name: 'Updated Supplies' }),
      );

      expect(error).toMatchObject({
        _tag: 'SupplierNotFound',
        id: 'missing-supplier',
      });
    }),
  );
});
