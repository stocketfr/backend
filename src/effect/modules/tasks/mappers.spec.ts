import { toTaskResponseDto } from './mappers';
import { makeTaskRow } from './__fixtures__/task';

describe('task mappers', () => {
  it('renders localized progress while preserving its descriptor', () => {
    const response = toTaskResponseDto(
      makeTaskRow({
        progress_total: 8,
        progress_processed: 2,
        progress_message_key: 'orders.invalidStatusTransition',
        progress_message_args: { from: 'draft', to: 'confirmed' },
      }),
      'en',
    );

    expect(response.progress).toEqual({
      total: 8,
      processed: 2,
      failed: 0,
      percent: 25,
      message: 'Cannot transition from draft to confirmed.',
      message_key: 'orders.invalidStatusTransition',
      message_args: { from: 'draft', to: 'confirmed' },
    });
  });
});
