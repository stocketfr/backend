import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { ClientStatus } from '@stocket/types/clients';
import { makeClientWriteWorkflows, type ClientWriteRepository } from './write';
import type { ClientEntity } from './types';

const tenantId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-03-01T00:00:00.000Z');

const makeClient = (overrides: Partial<ClientEntity> = {}): ClientEntity => ({
  id: 'client-1',
  tenant_id: tenantId,
  company_name: 'Acme Corp',
  yacht_name: null,
  contact_person: 'Jane Doe',
  email: 'jane@acme.test',
  phone: null,
  billing_address: null,
  default_delivery_address: null,
  account_status: ClientStatus.ACTIVE,
  payment_terms: null,
  credit_limit: null,
  notes: null,
  created_at: now,
  updated_at: now,
  ...overrides,
});

type ClientCreateData = Parameters<ClientWriteRepository['create']>[0];
type ClientUpdateData = Parameters<ClientWriteRepository['update']>[1];

const makeRepository = (
  overrides: Partial<ClientWriteRepository> = {},
): ClientWriteRepository => ({
  findByEmail: () => Effect.succeed(null),
  create: (values) =>
    Effect.succeed(
      makeClient({
        ...values,
        account_status: values.account_status ?? ClientStatus.ACTIVE,
      }),
    ),
  update: (_id, values) =>
    Effect.succeed(
      makeClient({
        ...values,
      }),
    ),
  ...overrides,
});

describe('makeClientWriteWorkflows', () => {
  it.effect('creates a client after checking for duplicate email', () =>
    Effect.gen(function* () {
      let checkedEmail: string | undefined;
      let capturedCreate: ClientCreateData | undefined;
      const repository = makeRepository({
        findByEmail: (email) =>
          Effect.sync(() => {
            checkedEmail = email;
            return null;
          }),
        create: (values) =>
          Effect.sync(() => {
            capturedCreate = values;
            return makeClient({
              id: 'client-new',
              ...values,
              account_status: values.account_status ?? ClientStatus.ACTIVE,
            });
          }),
      });
      const workflows = makeClientWriteWorkflows({
        repository,
        getClientOrFail: () => Effect.succeed(makeClient()),
      });

      const result = yield* workflows.create({
        company_name: 'New Co',
        contact_person: 'Ada Lovelace',
        email: 'ada@new.test',
        account_status: ClientStatus.SUSPENDED,
      });

      expect(checkedEmail).toBe('ada@new.test');
      expect(capturedCreate).toEqual({
        company_name: 'New Co',
        contact_person: 'Ada Lovelace',
        email: 'ada@new.test',
        yacht_name: null,
        phone: null,
        billing_address: null,
        default_delivery_address: null,
        account_status: ClientStatus.SUSPENDED,
        payment_terms: null,
        credit_limit: null,
        notes: null,
      });
      expect(result).toMatchObject({
        id: 'client-new',
        company_name: 'New Co',
        account_status: ClientStatus.SUSPENDED,
      });
    }),
  );

  it.effect('rejects duplicate emails on create without writing', () =>
    Effect.gen(function* () {
      let createCalled = false;
      const repository = makeRepository({
        findByEmail: () =>
          Effect.succeed(makeClient({ id: 'client-existing' })),
        create: () =>
          Effect.sync(() => {
            createCalled = true;
            return makeClient();
          }),
      });
      const workflows = makeClientWriteWorkflows({
        repository,
        getClientOrFail: () => Effect.succeed(makeClient()),
      });

      const error = yield* Effect.flip(
        workflows.create({
          company_name: 'New Co',
          contact_person: 'Ada Lovelace',
          email: 'jane@acme.test',
        }),
      );

      expect(error).toMatchObject({
        _tag: 'ClientEmailAlreadyExists',
        email: 'jane@acme.test',
      });
      expect(createCalled).toBe(false);
    }),
  );

  it.effect('returns the current client without writing an empty update', () =>
    Effect.gen(function* () {
      let updateCalled = false;
      const existing = makeClient({ company_name: 'Existing Co' });
      const repository = makeRepository({
        update: () =>
          Effect.sync(() => {
            updateCalled = true;
            return makeClient();
          }),
      });
      const workflows = makeClientWriteWorkflows({
        repository,
        getClientOrFail: () => Effect.succeed(existing),
      });

      const result = yield* workflows.update('client-1', {});

      expect(result.company_name).toBe('Existing Co');
      expect(updateCalled).toBe(false);
    }),
  );

  it.effect('updates changed fields after checking a changed email', () =>
    Effect.gen(function* () {
      let checkedEmail: string | undefined;
      let capturedUpdate:
        | {
            readonly id: string;
            readonly values: ClientUpdateData;
          }
        | undefined;
      const repository = makeRepository({
        findByEmail: (email) =>
          Effect.sync(() => {
            checkedEmail = email;
            return null;
          }),
        update: (id, values) =>
          Effect.sync(() => {
            capturedUpdate = { id, values };
            return makeClient({
              id,
              email: values.email ?? 'old@acme.test',
              company_name: values.company_name ?? 'Acme Corp',
            });
          }),
      });
      const workflows = makeClientWriteWorkflows({
        repository,
        getClientOrFail: () =>
          Effect.succeed(makeClient({ email: 'old@acme.test' })),
      });

      const result = yield* workflows.update('client-1', {
        company_name: 'Updated Co',
        email: 'new@acme.test',
      });

      expect(checkedEmail).toBe('new@acme.test');
      expect(capturedUpdate).toEqual({
        id: 'client-1',
        values: {
          company_name: 'Updated Co',
          email: 'new@acme.test',
        },
      });
      expect(result).toMatchObject({
        id: 'client-1',
        company_name: 'Updated Co',
        email: 'new@acme.test',
      });
    }),
  );

  it.effect('skips duplicate email lookup when the email is unchanged', () =>
    Effect.gen(function* () {
      let duplicateLookupCalled = false;
      const repository = makeRepository({
        findByEmail: () =>
          Effect.sync(() => {
            duplicateLookupCalled = true;
            return null;
          }),
      });
      const workflows = makeClientWriteWorkflows({
        repository,
        getClientOrFail: () =>
          Effect.succeed(makeClient({ email: 'jane@acme.test' })),
      });

      yield* workflows.update('client-1', { email: 'jane@acme.test' });

      expect(duplicateLookupCalled).toBe(false);
    }),
  );
});
