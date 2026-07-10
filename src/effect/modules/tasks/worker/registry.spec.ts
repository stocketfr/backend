import { Effect } from 'effect';
import { makeTaskRegistry } from './registry';
import type { TaskHandler } from './types';

const handler: TaskHandler = {
  type: 'test-task',
  run: () => Effect.succeed(null),
};

describe('TaskRegistry', () => {
  it('returns the registered handler', async () => {
    const registry = makeTaskRegistry([handler]);
    await expect(Effect.runPromise(registry.get('test-task'))).resolves.toBe(
      handler,
    );
  });

  it('fails with a tagged error for an unknown task type', async () => {
    const registry = makeTaskRegistry([]);
    const result = await Effect.runPromiseExit(registry.get('missing'));
    expect(result._tag).toBe('Failure');
    expect(String(result)).toContain('TaskHandlerNotFound');
  });

  it('rejects duplicate handler registrations', () => {
    expect(() => makeTaskRegistry([handler, handler])).toThrow(
      'Duplicate background task handler: test-task',
    );
  });
});
