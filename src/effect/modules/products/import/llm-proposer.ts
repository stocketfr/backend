import { Effect } from 'effect';
import type {
  ProductImportAiProposalV2Dto,
  ProductImportPreviewDto,
  ProductImportProposalGuidanceDto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import {
  getOpenAiProductImportConfig,
  type OpenAiProductImportConfig,
} from '../../../../config/openai.utils';
import { makeOpenAiProductImportProposalRequest } from './llm-proposal/request';
import {
  extractResponseText,
  sanitizeLlmProposal,
} from './llm-proposal/sanitizer';
import { appendWarning, messageFromUnknown } from './llm-proposal/shared';
import { makeProductImportProposal } from './utils/proposal';

type FetchLike = typeof fetch;

async function callOpenAiForProposal(
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto,
  guidance: ProductImportProposalGuidanceDto | undefined,
  config: OpenAiProductImportConfig,
  fetchImpl: FetchLike,
): Promise<ProductImportAiProposalV2Dto> {
  if (!config.apiKey) {
    return appendWarning(
      makeProductImportProposal(preview, context, guidance),
      'AI proposal unavailable because OPENAI_API_KEY is not configured.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(
      `${config.baseUrl.replace(/\/+$/, '')}/responses`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify(
          makeOpenAiProductImportProposalRequest(
            preview,
            context,
            guidance,
            config,
          ),
        ),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `OpenAI proposal request failed with status ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
      );
    }

    const json = await response.json();
    return sanitizeLlmProposal(
      JSON.parse(extractResponseText(json)),
      preview,
      context,
      guidance,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export class ProductImportLlmProposer extends Effect.Service<ProductImportLlmProposer>()(
  '@stocket/effect/products/ProductImportLlmProposer',
  {
    effect: Effect.sync(() => {
      const propose = (
        preview: ProductImportPreviewDto,
        context: ProductImportTargetContextDto,
        guidance?: ProductImportProposalGuidanceDto,
      ): Effect.Effect<ProductImportAiProposalV2Dto> =>
        Effect.tryPromise({
          try: () =>
            callOpenAiForProposal(
              preview,
              context,
              guidance,
              getOpenAiProductImportConfig(),
              globalThis.fetch.bind(globalThis),
            ),
          catch: (cause) => cause,
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.succeed(
              appendWarning(
                makeProductImportProposal(preview, context, guidance),
                `AI proposal unavailable: ${messageFromUnknown(cause, String(cause))}`,
              ),
            ),
          ),
        );

      return { propose };
    }),
  },
) {}
