import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsoleTransport } from './console';

describe('console email transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the from field when sending an email', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const transport = createConsoleTransport();

    await transport.send({
      from: 'Stocket <hello@stocket.test>',
      to: 'jeanne@stocket.test',
      subject: 'Welcome',
      html: '<a href="https://stocket.test/welcome">Welcome</a>',
      text: 'Open https://stocket.test/welcome',
    });

    expect(info).toHaveBeenCalledWith(
      [
        '[email:console] from="Stocket <hello@stocket.test>" to=jeanne@stocket.test subject="Welcome"',
        '[email:console]   link: https://stocket.test/welcome',
      ].join('\n'),
    );
  });
});
