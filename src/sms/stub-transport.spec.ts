import { describe, expect, it, vi } from 'vitest';
import { createStubSmsTransport, SmsNotImplementedError } from './stub-transport';

describe('createStubSmsTransport', () => {
  it('rejects every send with SmsNotImplementedError', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport = createStubSmsTransport();

    await expect(
      transport.send({ to: '+15551234567', from: 'Stocket', body: 'hi' }),
    ).rejects.toBeInstanceOf(SmsNotImplementedError);
  });
});
