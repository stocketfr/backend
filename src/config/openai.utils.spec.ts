import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOpenAiProductImportConfig } from './openai.utils';

describe('OpenAI product import config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses safe defaults when optional values are absent', () => {
    vi.stubEnv('OPENAI_API_KEY', '');

    expect(getOpenAiProductImportConfig()).toEqual({
      apiKey: undefined,
      model: 'gpt-5-mini',
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 60000,
    });
  });

  it('disables API key usage when PRODUCT_IMPORT_LLM_ENABLED is false', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('PRODUCT_IMPORT_LLM_ENABLED', 'false');

    expect(getOpenAiProductImportConfig().apiKey).toBeUndefined();
  });

  it('reads model, base URL, and timeout overrides', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('PRODUCT_IMPORT_LLM_MODEL', 'test-model');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.test/v1');
    vi.stubEnv('PRODUCT_IMPORT_LLM_TIMEOUT_MS', '2500');

    expect(getOpenAiProductImportConfig()).toEqual({
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 2500,
    });
  });

  it('rejects invalid timeout values', () => {
    vi.stubEnv('PRODUCT_IMPORT_LLM_TIMEOUT_MS', '0');

    expect(() => getOpenAiProductImportConfig()).toThrow(
      'PRODUCT_IMPORT_LLM_TIMEOUT_MS must be a positive integer',
    );
  });
});
