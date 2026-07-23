import { readOptionalEnv } from '@stocket/types/common';

export interface OpenAiProductImportConfig {
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
}

const parsePositiveInteger = (
  name: string,
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
};

export function getOpenAiProductImportConfig(
  env: Record<string, string | undefined> = process.env,
): OpenAiProductImportConfig {
  const enabled =
    (readOptionalEnv('PRODUCT_IMPORT_LLM_ENABLED', env) ?? 'true')
      .trim()
      .toLowerCase() !== 'false';

  return {
    apiKey: enabled ? readOptionalEnv('OPENAI_API_KEY', env) : undefined,
    model: readOptionalEnv('PRODUCT_IMPORT_LLM_MODEL', env) ?? 'gpt-5-mini',
    baseUrl:
      readOptionalEnv('OPENAI_BASE_URL', env) ?? 'https://api.openai.com/v1',
    timeoutMs: parsePositiveInteger(
      'PRODUCT_IMPORT_LLM_TIMEOUT_MS',
      readOptionalEnv('PRODUCT_IMPORT_LLM_TIMEOUT_MS', env),
      60000,
    ),
  };
}
