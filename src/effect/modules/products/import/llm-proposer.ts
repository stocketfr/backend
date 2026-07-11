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
import { decodeOpenAiProposalResponse } from './llm-proposal/raw';
import { sanitizeLlmProposal } from './llm-proposal/sanitizer';
import { appendWarning, messageFromUnknown } from './llm-proposal/shared';
import { makeProductImportProposal } from './utils/proposal';

type FetchLike = typeof fetch;

const callOpenAiForProposal = (
  preview: ProductImportPreviewDto,
  context: ProductImportTargetContextDto,
  guidance: ProductImportProposalGuidanceDto | undefined,
  config: OpenAiProductImportConfig,
  fetchImpl: FetchLike,
): Effect.Effect<ProductImportAiProposalV2Dto, unknown> => {
  if (!config.apiKey) {
    return Effect.succeed(
      appendWarning(
        makeProductImportProposal(preview, context, guidance),
        'AI proposal unavailable because OPENAI_API_KEY is not configured.',
      ),
    );
  }

  return Effect.suspend(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/responses`, {
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
          }),
        catch: (cause) => cause,
      });

      if (!response.ok) {
        const body = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => '',
        }).pipe(Effect.merge);
        return yield* Effect.fail(
          new Error(
            `OpenAI proposal request failed with status ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
          ),
        );
      }

      const json: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) => cause,
      });
      const rawProposal = yield* decodeOpenAiProposalResponse(json);
      return sanitizeLlmProposal(rawProposal, preview, context, guidance);
    }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timeout))));
  });
};

export class ProductImportLlmProposer extends Effect.Service<ProductImportLlmProposer>()(
  '@stocket/effect/products/ProductImportLlmProposer',
  {
    effect: Effect.sync(() => {
      const propose = (
        preview: ProductImportPreviewDto,
        context: ProductImportTargetContextDto,
        guidance?: ProductImportProposalGuidanceDto,
      ): Effect.Effect<ProductImportAiProposalV2Dto> =>
        callOpenAiForProposal(
          preview,
          context,
          guidance,
          getOpenAiProductImportConfig(),
          globalThis.fetch.bind(globalThis),
        ).pipe(
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
