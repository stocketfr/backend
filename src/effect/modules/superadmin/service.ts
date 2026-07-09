import { Effect } from 'effect';
import type { CreateSuperAdminTenantInput } from '@stocket/types/superadmin';
import type {
  FeatureKey,
  UpdateTenantFeatureOverride,
  UpdateTenantPlan,
} from '@stocket/types/features';
import type { UserSession } from '../../platform/auth/user-session';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { BetterAuth } from '../../platform/auth/better-auth';
import { UsersRepository } from '../users/repository';
import { SuperAdminRepository } from './repository';
import { FeaturesService } from '../features/service';
import { ProductImportService } from '../products/import/service';
import { makeCreateTenantWorkflow } from './create-tenant';
import { makeDeleteTenantWorkflow } from './delete-tenant';
import {
  toSuperAdminMeResponse,
  toSuperAdminTenantListResponse,
} from './mappers';

export class SuperAdminService extends Effect.Service<SuperAdminService>()(
  '@stocket/effect/superadmin/SuperAdminService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* SuperAdminRepository;
      const usersRepository = yield* UsersRepository;
      const betterAuth = yield* BetterAuth;
      const featuresService = yield* FeaturesService;
      const productImportService = yield* ProductImportService;
      const trace = makeServiceTracer({
        serviceName: 'SuperAdminService',
        module: 'superadmin',
        layer: 'service',
        entityType: 'tenant',
      });
      const me = trace.traced('me', (session: UserSession) =>
        Effect.succeed(toSuperAdminMeResponse(session)),
      );

      const listTenants = trace.traced('listTenants', () =>
        Effect.map(repository.listTenants(), toSuperAdminTenantListResponse),
      );

      const createTenant = trace.traced(
        'createTenant',
        makeCreateTenantWorkflow({
          repository,
          usersRepository,
          betterAuth,
          productImportService,
        }),
        (input: CreateSuperAdminTenantInput) => ({
          attributes: { entityId: input.slug },
        }),
      );

      const getTenantFeatures = trace.traced(
        'getTenantFeatures',
        (tenantId: string) => featuresService.getFeaturesForTenant(tenantId),
        (tenantId) => ({ attributes: { tenantId } }),
      );

      const deleteTenantWorkflow = makeDeleteTenantWorkflow({
        repository,
        invalidateTenant: featuresService.invalidateTenant,
      });

      const deleteTenant = trace.traced(
        'deleteTenant',
        (
          tenantId: string,
          actor: {
            readonly userId: string;
            readonly ipAddress?: string | null;
            readonly userAgent?: string | null;
          },
        ) => deleteTenantWorkflow.deleteTenant(tenantId, actor),
        (tenantId) => ({ attributes: { tenantId } }),
      );

      const updateTenantPlan = trace.traced(
        'updateTenantPlan',
        (tenantId: string, dto: UpdateTenantPlan, actorUserId: string) =>
          featuresService.setTenantPlan(tenantId, dto, actorUserId),
        (tenantId) => ({ attributes: { tenantId } }),
      );

      const updateTenantFeatureOverride = trace.traced(
        'updateTenantFeatureOverride',
        (
          tenantId: string,
          featureKey: FeatureKey,
          dto: UpdateTenantFeatureOverride,
          actorUserId: string,
        ) =>
          featuresService.setFeatureOverride(
            tenantId,
            featureKey,
            dto,
            actorUserId,
          ),
        (tenantId, featureKey) => ({
          attributes: { tenantId, entityId: featureKey },
        }),
      );

      const clearTenantFeatureOverride = trace.traced(
        'clearTenantFeatureOverride',
        (tenantId: string, featureKey: FeatureKey) =>
          featuresService.clearFeatureOverride(tenantId, featureKey),
        (tenantId, featureKey) => ({
          attributes: { tenantId, entityId: featureKey },
        }),
      );

      return {
        me,
        listTenants,
        createTenant,
        getTenantFeatures,
        deleteTenant,
        updateTenantPlan,
        updateTenantFeatureOverride,
        clearTenantFeatureOverride,
      };
    }),
    dependencies: [
      SuperAdminRepository.Default,
      UsersRepository.Default,
      FeaturesService.Default,
      ProductImportService.Default,
    ],
  },
) {}
