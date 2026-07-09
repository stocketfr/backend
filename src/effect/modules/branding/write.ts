import { Effect } from 'effect';
import type {
  BrandingResponseDto,
  UpdateBrandingDto,
} from '@stocket/types/branding';
import { BrandingInfrastructureError } from './branding.errors';
import { toBrandingResponse } from './mappers';
import type { BrandingSettingsRow } from './types';

export interface BrandingWriteRepository {
  readonly findSettings: (
    tenantId: string,
  ) => Effect.Effect<BrandingSettingsRow | null, BrandingInfrastructureError>;
  readonly upsertSettings: (
    tenantId: string,
    dto: UpdateBrandingDto,
    userId: string,
  ) => Effect.Effect<unknown, BrandingInfrastructureError>;
}

interface BrandingWriteWorkflowOptions {
  readonly repository: BrandingWriteRepository;
}

export const makeBrandingWriteWorkflows = ({
  repository,
}: BrandingWriteWorkflowOptions) => {
  const update = (
    tenantId: string,
    dto: UpdateBrandingDto,
    userId: string,
  ): Effect.Effect<BrandingResponseDto, BrandingInfrastructureError> =>
    Effect.gen(function* () {
      yield* repository.upsertSettings(tenantId, dto, userId);

      const settings = yield* repository.findSettings(tenantId);
      if (!settings) {
        return yield* Effect.fail(
          new BrandingInfrastructureError({
            action: 'load persisted branding settings',
            messageKey: 'branding.repositoryFailed',
          }),
        );
      }

      return toBrandingResponse(settings);
    });

  return { update };
};
